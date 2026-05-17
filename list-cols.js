const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function list() {
    const { data, error } = await supabase.rpc('get_table_info', { t_name: 'clients' });
    if (error) {
        // If RPC doesn't exist, try a simple select
        const { data: d, error: e } = await supabase.from('clients').select('*').limit(1);
        if (d && d.length > 0) {
            console.log('Columns found:', Object.keys(d[0]));
        } else {
            console.log('No data found to check columns.');
        }
    }
}

list();
