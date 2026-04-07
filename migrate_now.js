const { createClient } = require('@supabase/supabase-js');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    console.error('❌ Credentials missing');
    process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const dbPath = path.join(__dirname, 'test.db');

async function migrate() {
    console.log('🚀 Starting Data Migration...');
    const SQL = await initSqlJs();
    if (!fs.existsSync(dbPath)) {
        console.error('❌ test.db missing');
        return;
    }

    const db = new SQL.Database(fs.readFileSync(dbPath));

    const getTableData = (name) => {
        try {
            const res = db.exec(`SELECT * FROM ${name}`);
            if (!res[0]) return [];
            return res[0].values.map(row => {
                const o = {};
                res[0].columns.forEach((c, i) => { o[c] = row[i]; });
                return o;
            });
        } catch(e) { return []; }
    };

    try {
        const opts = getTableData('options');
        if (opts.length > 0) await supabase.from('options').upsert(opts);

        const rawActs = getTableData('activities');
        for (const a of rawActs) {
            await supabase.from('activities').upsert({
                ...a,
                mandatory: JSON.parse(a.mandatory || '[]'),
                optional: JSON.parse(a.optional || '[]')
            });
        }

        const stats = getTableData('materials');
        if (stats.length > 0) await supabase.from('materials').upsert(stats);

        const clients = getTableData('clients');
        console.log(`- Migrating ${clients.length} clients...`);
        for (let i = 0; i < clients.length; i += 20) {
            const batch = clients.slice(i, i + 20).map(c => ({
                ...c,
                options: JSON.parse(c.options || '[]'),
                potential: !!c.potential,
                called: !!c.called,
                autoReminder: !!c.autoReminder
            }));
            const { error } = await supabase.from('clients').upsert(batch);
            if (error) throw error;
        }

        console.log('✅ Migration COMPLETE!');
    } catch (err) {
        console.error('❌ ERROR:', err.message);
    }
}

migrate();
