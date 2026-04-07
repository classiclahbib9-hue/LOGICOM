const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function check() {
    const { data, error } = await supabase.from('clients').select('autoReminder').limit(1);
    if (error) {
        console.log('Error querying autoReminder:', error.message);
    } else {
        console.log('✅ Column autoReminder found!');
    }
}

check();
