const TelegramBot = require('node-telegram-bot-api');
const { addClientManually, getUnpaidClientsByPeriod, getDB, savePaymentPromise } = require('./db');
const { parsePromiseWithGroq } = require('./promise-parser');
const { sendWhatsApp, isWhatsAppReady } = require('./whatsapp');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { app, Notification } = require('electron');

const GROQ_SYSTEM_PROMPT = `أنت مساعد ذكي اسمك "لوجي" تتكلم الدارجة الجزائرية فقط.
تعمل لدى شركة LOGICOM الجزائرية متخصصة في بيع برامج تسيير الأعمال.

== منتجات LOGICOM ==
- برنامج تسيير السوبيرات والحوانت (caisse + stock + clients)
- برنامج الصيدلية (médicaments + ordonnances + caisse)
- برنامج المخبزة (production + caisse + livraisons)
- برنامج القنصلية / مواد البناء (stock + bons de commande)
- برنامج الصناعة (nomenclature + ordres de fabrication + stock matières)
- برنامج المطعم / الكافيه (caisse tactile + tables + livreurs)
الأسعار تبدأ من 15,000 DA وتختلف حسب الباكاج.
الدعم التقني متوفر والتركيب في عين المكان.

== أسلوب الكلام ==
IMPORTANT: جاوب دايما بالدارجة الجزائرية — ما تستعملش العربية الفصحى أبدا.
أمثلة دارجة حقيقية: "واش راك؟", "كيفاش نقدر نعاونك؟", "بصح", "مزيان", "روح", "جي", "بلا ما", "ماشي مشكل", "واخا", "صافي", "بزاف", "شويا", "دروك", "ديما", "يزي", "عادي", "هاني هنا باش نعاونك".
إذا كلمك المستخدم بالفرنسية، جاوبه بالفرنسية مع بعض كلمات دارجة.
كون مختصر ومفيد — جملتين أو ثلاثة تكفي. ما تكتبش ردود طويلة.
إذا السؤال تقني معقد، قول ليه يتصل بالدعم التقني تاع LOGICOM.

== الأوامر ==
/nouveau — إضافة عميل جديد
/reset — مسح تاريخ المحادثة`;

// ── Packs & FAQ ───────────────────────────────────────────────────────────────
const PACKS_FILE = path.join(__dirname, 'packs.json');

function loadPacks() {
    try { return JSON.parse(fs.readFileSync(PACKS_FILE, 'utf8')); }
    catch(e) { return {}; }
}

const SECTEUR_KEYWORDS = {
    superette:     [
        'superette','supérette','epicerie','épicerie','magasin','hanout',
        'supermarche','supermarché','l7anout','hanout kabir','grocerie',
        'bakkala','mghaza','dukkan',
    ],
    pharmacie:     [
        'pharmacie','medicament','médicament','ordonnance','pharmacien',
        'saidliya','saydaliya','dawa','dar edwa','dawakher','dkhtar',
        'docteur','tbib','mridh','mridha','dwa',
    ],
    boulangerie:   [
        'boulangerie','patisserie','pâtisserie','pain','gateau','gâteau',
        'khobz','el khabbez','ferran','halwani','mkhabez','khobzji',
        'mkhbez','7lwa','lgâtto','smida',
    ],
    quincaillerie: [
        'quincaillerie','materiaux','matériaux','ferronnerie','outillage',
        'hdida','7dida','matériels bâtiment','matriaux','fer','benna',
        'masson','binaya','construction','mifta7','sarout',
    ],
    industrie:     [
        'industrie','usine','fabrication','production','atelier','masna3',
        'mas3na','msan3','fabrik','machine','ordres fabrication',
        'nomenclature','stock matières','matières premières',
    ],
    restaurant:    [
        'restaurant','cafe','café','snack','pizzeria','brasserie',
        'mat3am','kahwa','9ahwa','mta3am','traiteur','sandwicherie',
        'cafeteria','cantine','rotisserie','rôtisserie',
    ],
};

const FAQ = [
    {
        kw_fr:     ['prix','tarif','pack','combien','abonnement','coûte','coute','cout','offre'],
        kw_dz:     ['qaddach','qadech','taman','pack','flouss','bchhal','sh7al','9addesh','rkhiss','ghali','prix','tarif'],
        pack_query: true,
    },
    {
        kw_fr:     ['installer','installation','télécharger','telecharger','setup','configurer'],
        kw_dz:     ['install','nsob','rockeb','setup','tanzil','rockbi','nasab','dkhal','t-install','kif n-install'],
        ans_fr:    '⚙️ Pour installer :\n1. Téléchargez le setup\n2. Lancez en administrateur\n3. Suivez les étapes',
        ans_dz:    '⚙️ Bach t-install :\n1. Nzal setup\n2. D-marré ki administrateur\n3. Sib l-étapes',
        youtube:   null,
    },
    {
        kw_fr:     ['facture','devis','facturation','bon de vente','reçu'],
        kw_dz:     ['facture','fatura','devis','reçu','tassdir','7essab','7sab'],
        ans_fr:    '🧾 Créer une facture :\nMenu → Ventes → Nouvelle facture',
        ans_dz:    '🧾 Bach dir facture :\nMenu → Ventes → Facture jadida',
        youtube:   'https://youtu.be/G1Cq_O7FkpM?si=055cWd84zlmDnLPB',
    },
    {
        kw_fr:     ['vente','nouvelle vente','faire une vente','bon de vente','vendre'],
        kw_dz:     ['vente','biya3','bi3','nbi3','dir vente','vendre','tsara'],
        ans_fr:    '🛒 Faire une vente :\nMenu → Ventes → Nouvelle vente\n\nAjoutez les articles, choisissez le client et validez.',
        ans_dz:    '🛒 Bach dir vente :\nMenu → Ventes → Vente jadida\n\nZid articles, khtar client w validi.',
        youtube:   'https://youtu.be/G1Cq_O7FkpM?si=055cWd84zlmDnLPB',
    },
    {
        kw_fr:     ['retour','retour article','avoir','annuler vente','remboursement','retour client'],
        kw_dz:     ['retour','rad','raddo','rjja3','rjja3 sel3a','annuler','avoir','raddha'],
        ans_fr:    '↩️ Retour sur article :\nMenu → Ventes → Retour / Avoir\n\nSélectionnez la vente concernée et les articles à retourner.',
        ans_dz:    '↩️ Bach dir retour 3la article :\nMenu → Ventes → Retour / Avoir\n\nKhtar vente w articles lli bghit traddha.',
        youtube:   'https://youtu.be/G1Cq_O7FkpM?si=055cWd84zlmDnLPB',
    },
    {
        kw_fr:     ['stock','gestion stock','entrée stock','sortie stock','bon entrée','bon sortie'],
        kw_dz:     ['stock','makhzen','ble3','dakhel','khrej','bon entree','bon sortie'],
        ans_fr:    '📦 Gestion stock :\nMenu → Stock → Bon d\'entrée / Bon de sortie',
        ans_dz:    '📦 Gestion stock :\nMenu → Stock → Bon d\'entrée / Bon de sortie',
        youtube:   null,
    },
    {
        kw_fr:     ['inventaire','écart','inventaire physique','la9wam','écart stock','régularisation','compter stock'],
        kw_dz:     ['inventaire','la9wam','la9ouam','9wam','ecartes','écart','farka','farq','9ol inventaire','dir inventaire','kifach inventaire','chuf stock'],
        ans_fr:    '📋 Faire l\'inventaire :\nMenu → Stock → Inventaire\n\n1. Lancez un nouvel inventaire\n2. Saisissez les quantités réelles\n3. Validez pour voir les écarts automatiquement',
        ans_dz:    '📋 Kifach tdir l\'inventaire (la9wam) :\nMenu → Stock → Inventaire\n\n1. Ibda inventaire jdid\n2. Dkhel les quantités li 3andek f l\'magasin\n3. Validi — le programme ydirlek l\'écart wehdou',
        youtube:   'https://youtu.be/w_sUGo5b-1k?si=TcoKhf4AhwCqS868',
    },
    {
        kw_fr:     ['article','produit','nouveau article','ajouter article','créer article','nomenclature'],
        kw_dz:     ['article','sel3a','ssel3a','7wayedj','produit','zid article','nouveau article'],
        ans_fr:    '🗂️ Créer un article :\nMenu → Articles → Nouvel article\n\nRemplissez : désignation, prix, unité, stock min.',
        ans_dz:    '🗂️ Bach tzid article jdid :\nMenu → Articles → Article jadid\n\nAkteb : smiya, prix, unité, stock min.',
        youtube:   'https://youtu.be/9BHnAxvSN9k?si=sco6tfDP8GQJqPwh',
    },
    {
        kw_fr:     ['achat','fournisseur','bon achat','commande fournisseur','approvisionnement'],
        kw_dz:     ['achat','fournisseur','fourn','chira','9ayed','commande','approvi','tsara','ta9addamt'],
        ans_fr:    '🛍️ Faire un achat / fournisseur :\nMenu → Achats → Nouveau bon d\'achat\n\nChoisissez le fournisseur, ajoutez les articles et validez.',
        ans_dz:    '🛍️ Bach dir achat m3a fournisseur :\nMenu → Achats → Bon d\'achat jadid\n\nKhtar fournisseur, zid articles w validi.',
        youtube:   'https://youtu.be/9BHnAxvSN9k?si=sco6tfDP8GQJqPwh',
    },
    {
        kw_fr:     ['bug','erreur','problème','probleme','marche pas','bloque','crash','plante'],
        kw_dz:     ['bug','mochkil','moshkil','ma khdamch','ma khdamtch','bloqué','yetblok','khrab','ma khdamch','wqef','t9awed'],
        ans_fr:    '🛠️ Problème technique :\n1. Fermez et relancez\n2. Vérifiez le réseau\n\nSi ça persiste → contactez le support LOGICOM.',
        ans_dz:    '🛠️ Mochkil technique :\n1. Saker w 3awed iftah\n2. Chek réseau\n\nIla mzal → contacti support LOGICOM.',
        youtube:   null,
    },
    {
        kw_fr:     ['caisse','encaissement','vente','ticket'],
        kw_dz:     ['caisse','kassa','sandou9','sandok','biya3','bi3','vente'],
        ans_fr:    '🛒 Caisse enregistreuse :\nMenu → Caisse → Nouvelle vente',
        ans_dz:    '🛒 Bach t-dir caisse :\nMenu → Caisse → Vente jadida',
        youtube:   'https://youtu.be/G1Cq_O7FkpM?si=055cWd84zlmDnLPB',
    },
    {
        kw_fr:     ['suivi caisse','journal caisse','clôture caisse','historique caisse','solde caisse','mouvement caisse'],
        kw_dz:     ['suivi caisse','journal caisse','clôture','7sab caisse','wain flouss','mouvement','solde','kassa suivi'],
        ans_fr:    '📊 Suivi de caisse :\nMenu → Caisse → Journal / Clôture\n\nConsultez tous les mouvements et le solde en temps réel.',
        ans_dz:    '📊 Bach tsuivi caisse :\nMenu → Caisse → Journal / Clôture\n\nTchuf kol mouvements w solde f waqtha.',
        youtube:   'https://youtu.be/IGQ2wfsUtsw?si=UYMCpSXk6UYvrq8R',
    },
    {
        kw_fr:     ['charge','dépense','frais','créer charge','ajouter charge','charges'],
        kw_dz:     ['charge','dépense','frais','masroufa','masarif','dir charge','zid charge','nafaqa'],
        ans_fr:    '💸 Créer une charge :\nMenu → Comptabilité → Charges → Nouvelle charge\n\nSaisissez le montant, la catégorie et la date.',
        ans_dz:    '💸 Bach dir charge :\nMenu → Comptabilité → Charges → Charge jadida\n\nAkteb montant, catégorie w date.',
        youtube:   'https://youtu.be/IGQ2wfsUtsw?si=UYMCpSXk6UYvrq8R',
    },
    {
        kw_fr:     ['compte','plan comptable','créer compte','comptabilité','grand livre','bilan'],
        kw_dz:     ['compte','comptabilité','plan comptable','7sab','7ssab','bilan','grand livre','zid compte'],
        ans_fr:    '📒 Gestion des comptes :\nMenu → Comptabilité → Plan comptable → Nouveau compte\n\nDéfinissez le code, l\'intitulé et le type de compte.',
        ans_dz:    '📒 Bach dir compte :\nMenu → Comptabilité → Plan comptable → Compte jadid\n\nAkteb code, smiya w type nta3 compte.',
        youtube:   'https://youtu.be/IGQ2wfsUtsw?si=UYMCpSXk6UYvrq8R',
    },
    {
        kw_fr:     ['client','fiche client','base client','ajouter client','nouveau client','créer client'],
        kw_dz:     ['client','3miyl','3amil','zaboune','zaboun','fiche','dossier','zid client'],
        ans_fr:    '👤 Gestion clients :\nMenu → Clients → Ajouter / Modifier',
        ans_dz:    '👤 Gestion clients :\nMenu → Clients → Zid / Beddel',
        youtube:   'https://youtu.be/9BHnAxvSN9k?si=sco6tfDP8GQJqPwh',
    },
    {
        kw_fr:     ['essai','demo','tester','gratuit','trial'],
        kw_dz:     ['essai','demo','tester','gratuit','mjaani','bla flous','njarreb','test'],
        ans_fr:    '🆓 Demandez une démo gratuite !\nContactez-nous et on vous installe une version d\'essai.',
        ans_dz:    '🆓 T9addar tjarreb bla flous !\nContacti-na w ndirlak version demo.',
        youtube:   null,
    },
];

function detectLanguage(text) {
    const t = text.toLowerCase();

    // ── 450 signals extracted from full Algerian Darija Dziri vocabulary ─────
    const signals = [
        // Single-char class (short but definitive Darija)
        'ih','hia','wah','mra','sa7','ba3','bi3','3id','sa7a','lala','7ala',
        'khti','druk','sa3a','dima','zzit','jben','atay','t3am','l7am','7out',
        'tamr','sifr','tnin','alef','rob3','mli7','9dim','jdid','kbir','twil',
        'r9i9','rfi3','t9il','s3ib','d3if','9rib','b3id','souk','bhar','wadi',
        'ddar','chqa','ta9a','baba','3juz','ra3i','ra3d','7mar','3yni','tla9',
        'ra9i','sla7','tba3','ida3','fri9','ti9i',
        // Greetings & social
        'salam','ghaya','3afak','yakho','sahbi','ssa3a','lwa9t','lyoum',
        'ssba7','d9i9a','smana','shhar','bekri','labess','wakhha','sme7li',
        'khouya','omba3d','ghadwa','bezzaf','matcharfin','fra7tlek','ya 3zizi',
        'el bare7','le3shiya','wa9telli','fel sba7','sba7 ennour','besmellah',
        'nchallah','3am sa3id','wella rak','llah y3awnek','barakallahoufik',
        'mabrouk 3lik','sba7 el khir','mess el khir','tasba7 bkhir','b9a 3la khir',
        'salam 3likoum','w 3likoum salam','netla9aw omba3d','matet9alle9sh',
        'matkhemmemsh','rabbit m3ak','rabbi ya9bel','rabbi yar7amha','rabbi yarra7mou',
        'wesh rak','wesh raki','ki dayer','ki dayra','ma3liksh','ma3liche',
        'kesh jdid','wassemni','tfaddal','wesh dert fiha','7amdoullah','habibi',
        // State / quantity / time
        'rani','rahi','raha','rah','kayen','kayna','druk','dima','daba',
        'bezzaf','bzaaf','chwiya','kter','barcha','yezzi','3adi','metakh',
        'omba3d shwiya','wa9telli','3am el faret','3am el jey','shhar el faret',
        'shhar el jey','9addesh lwa9t','sh7al rahi ssa3a','sh7al fi 3omrek',
        // Questions / fillers
        'wesh','wach','kifesh','kifach','3lach','win','sh7al','wassmek',
        'fhamtini','yani','koulchi','elli','machi normal','machi sahel',
        // Pronouns / possession
        'nta','nti','ntia','3ndek','3ndi','3na','taa3i','taa3ak','taa3na',
        'taa3o','3andek','3andi','nta shbab','nti zwina','nti galbi',
        // Affirmation / negation
        'wakha','safi','ih','yak','lala','wella','machi','ma3andouch',
        // Street slang
        'sa7bi','sahbti','sa7bti','mli7a','mzyan','meziane','wali','wili',
        '7ala','zahri','hchouma','balak','hia','hak','haki','skout','roh',
        'aay','3ayit','far7an','mhazen','khayef','mhayyer','drari','jaw',
        'khorti','khrab','dazzit','3awed','bghit','kmel','3ayes','tfarraj',
        '7awes','khel','shuf','sem3','fhem','3ruf','rja3','dja','khrej',
        'dguel','nam','9am','kul','shreb','msha','msho','djer','ness',
        'buzzé','stalki','crushi','chibka','sla3a','tiktoka','friki',
        'hadi hadi','machi sahel','twa7achtek','tawa7achtek',
        // Food & drink
        'khobz','la7lib','farina','sokker','lmel7','3ssel','zebda','rayeb',
        '9ahwa','harissa','seksou','chorba','mechway','kaskrout','tchina',
        'khokh','della3','la3neb','na3ma','djwaz','smida','39a9er','7missa',
        '3adas','l7am','7out ma9li','atay benna3na3',
        // Numbers
        'wa7ed','zoudj','tlata','rab3a','khamsa','setta','sab3a','tmenia',
        'tess3a','3ashra','mia','mellioune','7desh','3ashrine','tlatine',
        'rab3ine','khamssine','seb3ine','tmanine','tess3ine',
        // Colors / adjectives
        'k7el','zre9','sfarr','rkhiss','ghali','sahel','sghir','9ssir',
        'khshine','r9i9','rfi3','t9il','smin','s3ib','d3if','mdewer',
        'bared','skhoun','mwessekh','chab3an','dji3an','far7an','3iyen',
        // Places
        'l7anout','hanout','souk','lmarché','sbitar','djame3','djami3a',
        'commissariat','barid','matar','tramway','douar','hay','mdina',
        'zer9a','dherb','djbal','bhar','sa7ra','plage','wadi','bu7ayra',
        // Jobs / people
        'tbib','tbiba','oustad','oustadha','fella7','ra3i','teyyab','3askri',
        'tajir','benna','masson','dekhtar','7allaq','mou3allem','mouhami',
        'mouhandis','retraité','khouya','yemma','jeddi','jeddati','3ammi',
        '3amti','rajel','drari','shabb','shebba','3djouza',
        // Market / money
        'flouss','dinar','nakhoudha','nkhalliha','ghali bezzaf','prix mli7',
        'prix shbab','prix 3eyan','ess7a7','khefef 3liya','lakhir ssel3',
        // Emotions
        'm3assebs','mghayedh','zm3an','fdalt','hshemt','fakhir','rti7t',
        '9ale9','mte9le9','gherdan','we7dan','meyyes','galbi','dha7ketni',
        'bekkani','ndmit','merta7','3asabi','mhayyer','t7emma','t9el3a',
        'rani 3iyen','rani 9ale9','rani dhaye3','ana 3ashe9','9albi mherres',
        'galbi y3awwerni','7assit nbeki','matdha7niesh','fi jaw mli7','fi jaw 3iyen',
        // Love
        'n7ebbek','bghitek','3zizi','rouhi','3yuni','7yati','nejmarti',
        'habibti','sa7abti','l7abib nta3i','l7abiba nta3i','zahri bik',
        'dbissama mli7a','ghira 3liya','matetrukniesh','rani nfakker fik',
        'koun m3aya','tqabli t3aishi m3aya','nhebb nkoun m3ak','3ioun zwinin',
        // Celebrations / religion
        'ramadan karim','sa7a ramdanek','sa7a ftourek','3id mubarak','sa7a 3idek',
        'sa7a mouloudek','yennayer amarvou7','l3arss','khtana','eddbi7a',
        'lilt el henna','salat el djom3a','ss7our','lftor','ssiyam','el adhan',
        // Home / objects
        'kouzina','hammam','knabu','frrash','zerbia','tawla','korssi','tanour',
        'frigidaire','brrad','lmba','ltelza','sarout','qfel','shanta','daftar',
        // Media / tech
        'mouski9a','musi9a','ughniya','mghanni','mghanniya','staifi','chaoui',
        'rradio','ltelza','akhbar','jerida','internet','tilifoune','les réseaux',
        'tsawira','stori','liker','partager','commenta','suivi','tiktoka',
        'influenceur','masra7','koura','stade','fri9','tnin tnin',
        // Misc verified Darija
        'mochkil','moshkil','fatura','makhzen','masna3','ma3foun',
        'ma7loul','msedded','ba3','shra','beddel','sa9','rak ma3rodh',
        'wesh sar','ma sar walou','machi normal','koul7a','sra9ti 9albi',
        'ma7asshtekch','ma3andouch khedma','rani n7awess 3la',
        'aay n7taflo m3ana','rahi tssabb eshta','ghadi tkoun mli7a',
        'la39oba lemyat sna','shems rahi tssatta3',
    ];

    const score = signals.filter(s => t.includes(s)).length
        + ([...text].some(c => c >= '\u0600' && c <= '\u06ff') ? 3 : 0);
    return score >= 1 ? 'dz' : 'fr';
}

function detectSecteur(text) {
    const t = text.toLowerCase();
    return Object.keys(SECTEUR_KEYWORDS).find(s => SECTEUR_KEYWORDS[s].some(kw => t.includes(kw))) || null;
}

function formatPack(secteur, lang) {
    const packs = loadPacks();
    const p = packs[secteur];
    if (!p) return null;
    const inclus = p.inclus.map(i => `  ✅ ${i}`).join('\n');
    if (lang === 'dz') {
        return {
            text: `🎯 *${p.nom}*\n\n💰 Prix : *${p.prix} DA*\n\nChnou kayen f-pack :\n${inclus}\n\nBach tachri wella t3allem aktar, contacti-na ! 📞`,
            youtube: p.youtube,
        };
    }
    return {
        text: `🎯 *${p.nom}*\n\n💰 Prix : *${p.prix} DA*\n\nCe pack inclut :\n${inclus}\n\nPour acheter ou en savoir plus, contactez-nous ! 📞`,
        youtube: p.youtube,
    };
}

function findFaq(text, lang) {
    const t = text.toLowerCase();
    const kwKey  = lang === 'dz' ? 'kw_dz' : 'kw_fr';
    const ansKey = lang === 'dz' ? 'ans_dz' : 'ans_fr';
    for (const entry of FAQ) {
        if (entry[kwKey].some(kw => t.includes(kw))) {
            if (entry.pack_query) return { type: 'pack_query' };
            return { type: 'answer', text: entry[ansKey], youtube: entry.youtube };
        }
    }
    return null;
}

function sendWithYoutube(bot, chatId, text, youtube) {
    const opts = { parse_mode: 'Markdown' };
    if (youtube) {
        opts.reply_markup = { inline_keyboard: [[{ text: '▶️ Voir tutoriel / Chof tutorial', url: youtube }]] };
    }
    return bot.sendMessage(chatId, text, opts);
}

function getGroqKey() {
    try {
        const telegramConfig = path.join(app.getPath('userData'), 'telegram-config.json');
        if (fs.existsSync(telegramConfig)) {
            const key = JSON.parse(fs.readFileSync(telegramConfig, 'utf8')).groqApiKey || '';
            if (key) return key;
        }
    } catch(e) {}
    try {
        const groqConfig = path.join(app.getPath('userData'), 'groq-config.json');
        if (fs.existsSync(groqConfig)) {
            return JSON.parse(fs.readFileSync(groqConfig, 'utf8')).groqApiKey || '';
        }
    } catch(e) {}
    return '';
}

function downloadBuffer(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
        }).on('error', reject);
    });
}

function transcribeVoice(audioBuffer) {
    return new Promise((resolve, reject) => {
        const boundary = 'Boundary' + Date.now();
        const header = Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="voice.ogg"\r\nContent-Type: audio/ogg\r\n\r\n`
        );
        const footer = Buffer.from(
            `\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3-turbo` +
            `\r\n--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nar` +
            `\r\n--${boundary}--\r\n`
        );
        const body = Buffer.concat([header, audioBuffer, footer]);
        const req = https.request({
            hostname: 'api.groq.com',
            path: '/openai/v1/audio/transcriptions',
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + getGroqKey(),
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': body.length
            }
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve(JSON.parse(data).text || ''); }
                catch(e) { reject(new Error(data)); }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function askGroq(userMessage, history) {
    return new Promise((resolve, reject) => {
        const messages = [
            { role: 'system', content: GROQ_SYSTEM_PROMPT },
            ...history.slice(-8),
            { role: 'user', content: userMessage }
        ];
        const body = JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: 350, messages });
        const req = https.request({
            hostname: 'api.groq.com',
            path: '/openai/v1/chat/completions',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + getGroqKey(),
                'Content-Length': Buffer.byteLength(body)
            }
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve(json.choices?.[0]?.message?.content || '...');
                } catch(e) { reject(new Error(data)); }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function getConfigPath() {
    return path.join(app.getPath('userData'), 'telegram-config.json');
}

let currentBot = null;

function initTelegram() {
    let config = { token: '', active: false };
    const configPath = getConfigPath();

    if (fs.existsSync(configPath)) {
        try {
            config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        } catch (e) {
            console.error('Error reading telegram config:', e);
        }
    }

    if (!config.token) {
        console.log('Telegram Bot Token not set. Please set it in the settings.');
        return;
    }

    if (currentBot) {
        try {
            currentBot.stopPolling();
        } catch (e) {}
    }

    console.log('Initializing Telegram Bot with token:', config.token.substring(0, 5) + '...');
    
    try {
        const bot = new TelegramBot(config.token, { polling: true });
        currentBot = bot;

        bot.on('polling_error', (error) => {
            console.error('Telegram Polling Error:', error.code, error.message);
        });

        const userStates = {}; // chatId -> { step: string, data: {} }
        const chatHistories = {}; // chatId -> [{role, content}]

        bot.on('message', async (msg) => {
            const chatId = msg.chat.id;
            try {

            // --- VOICE / VIDEO NOTE / AUDIO FILE ---
            const audioSource = msg.voice || msg.video_note || msg.audio;
            if (audioSource) {
                const groqKey = getGroqKey();
                if (!groqKey) { bot.sendMessage(chatId, "⚙️ Groq API Key manquante / ما كاينش Groq API Key."); return; }
                bot.sendChatAction(chatId, 'typing');
                let transcribed = '';
                try {
                    const fileLink = await bot.getFileLink(audioSource.file_id);
                    const audioBuffer = await downloadBuffer(fileLink);
                    transcribed = await transcribeVoice(audioBuffer);
                } catch(e) {
                    // one retry
                    try {
                        const fileLink = await bot.getFileLink(audioSource.file_id);
                        const audioBuffer = await downloadBuffer(fileLink);
                        transcribed = await transcribeVoice(audioBuffer);
                    } catch(e2) {
                        bot.sendMessage(chatId, "❌ ما قدرتش نفهم الصوت، عاود مرة أخرى.");
                        return;
                    }
                }
                if (!transcribed || !transcribed.trim()) {
                    bot.sendMessage(chatId, "❌ ما سمعتش والو في الصوت، حاول مرة أخرى.");
                    return;
                }
                const history = chatHistories[chatId] || [];
                bot.sendChatAction(chatId, 'typing');
                try {
                    const reply = await askGroq(transcribed, history);
                    history.push({ role: 'user', content: transcribed });
                    history.push({ role: 'assistant', content: reply });
                    chatHistories[chatId] = history.slice(-20);
                    // Show transcription then answer clearly separated
                    bot.sendMessage(chatId,
                        `🎙️ _"${transcribed.trim()}"_\n\n━━━━━━━━━━\n${reply}`,
                        { parse_mode: 'Markdown' }
                    );
                } catch(e) {
                    bot.sendMessage(chatId, "❌ فهمت كلامك بصح ما قدرتش نجاوب: " + e.message);
                }
                return;
            }

            const text = msg.text;
            if (!text) return;

            // --- AUTO-LINK: store telegramChatId for any known client who messages the bot ---
            try {
                const db = getDB();
                if (db) {
                    const linked = db.exec(`SELECT id FROM clients WHERE telegramChatId = '${chatId}' LIMIT 1`);
                    if (!linked.length) {
                        // Try to find by phone if client included it in text (e.g. "0661234567")
                        const phoneMatch = text.match(/0[567]\d{8}/);
                        if (phoneMatch) {
                            const p = phoneMatch[0];
                            db.run(`UPDATE clients SET telegramChatId='${chatId}' WHERE replace(phone,' ','')='${p}' OR replace(phone,' ','')='213${p.slice(1)}'`);
                        }
                    }
                }
            } catch(e) {}

            // --- COMMANDS ---
            const lang = detectLanguage(text);

            if (text === '/wastate') {
                const { getWhatsAppStatus } = require('./whatsapp');
                const status = getWhatsAppStatus();
                const statusMsg = {
                    ready:        '✅ WhatsApp connecté et prêt !',
                    connecting:   '⏳ WhatsApp en cours de connexion... Scannez le QR dans le terminal.',
                    disconnected: '❌ WhatsApp déconnecté. Relancez l\'application et scannez le QR code.',
                }[status] || '❓ Statut inconnu';
                bot.sendMessage(chatId, statusMsg);
                return;
            }

            if (text === '/reset') {
                delete chatHistories[chatId];
                const resetMsg = lang === 'dz'
                    ? '🔄 صافي! مسحت تاريخ المحادثة. واش عندك سؤال جديد؟'
                    : '🔄 Historique effacé ! Posez votre nouvelle question.';
                bot.sendMessage(chatId, resetMsg);
                return;
            }

            if (text === '/start' || text === '/help') {
                const welcome = lang === 'dz'
                    ? `👋 *Salam ! Marhba bik f LOGICOM* 🇩🇿\n\nChnou naw3 l-activité taa3ak ?\n\n🏪 Supérette  💊 Pharmacie  🥖 Boulangerie\n🔧 Quincaillerie  🏭 Industrie  🍕 Restaurant\n\nWella soel s-so2al taa3ak ! 😊`
                    : `👋 *Bonjour ! Bienvenue chez LOGICOM* 🇩🇿\n\nQuel type d'activité avez-vous ?\n\n🏪 Supérette  💊 Pharmacie  🥖 Boulangerie\n🔧 Quincaillerie  🏭 Industrie  🍕 Restaurant\n\nOu posez directement votre question ! 😊`;
                bot.sendMessage(chatId, welcome, { parse_mode: 'Markdown' });
                return;
            }

            if (text === '/rappel') {
                bot.sendMessage(chatId,
                    `🔔 *RAPPELS IMPAYÉS*\n\nChoisissez la période de filtre :`,
                    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
                        [
                            { text: '1 mois',  callback_data: 'rappel_30'  },
                            { text: '3 mois',  callback_data: 'rappel_90'  },
                        ],
                        [
                            { text: '6 mois',  callback_data: 'rappel_180' },
                            { text: '8 mois',  callback_data: 'rappel_240' },
                        ],
                        [
                            { text: '1 an',    callback_data: 'rappel_365' },
                            { text: 'Tous',    callback_data: 'rappel_0'   },
                        ],
                    ]}}
                );
                return;
            }

            if (text === '/nouveau' || text.toLowerCase() === 'nouveau') {
                userStates[chatId] = { step: 'WAITING_TYPE', data: {} };
                bot.sendMessage(chatId,
                    `🆕 *NOUVEAU CLIENT — ÉTAPE 1/6*\n\nC'est un client *nouveau* ou *existant* ?\n\nRépondez : *nouveau* ou *existant*`,
                    { parse_mode: 'Markdown', reply_markup: {
                        inline_keyboard: [
                            [{ text: '✨ Nouveau Client', callback_data: 'type_nouveau' }],
                            [{ text: '🔄 Client Existant (vente additionnelle)', callback_data: 'type_existant' }]
                        ]
                    }}
                );
                return;
            }

            // --- WIZARD STATE MACHINE ---
            const state = userStates[chatId];
            if (state && (msg.reply_to_message || state.step === 'WAITING_TYPE')) {

                if (state.step === 'WAITING_TYPE') {
                    const t2 = text.toLowerCase();
                    if (t2.includes('exist') || t2.includes('ancien') || t2.includes('vieux') || t2.includes('9dim')) {
                        state.data.category = 'Existant';
                    } else {
                        state.data.category = 'Nouveau';
                    }
                    state.step = 'WAITING_NAME';
                    bot.sendMessage(chatId,
                        `👤 *ÉTAPE 2/6*\nQuel est le *NOM COMPLET* du client ?`,
                        { parse_mode: 'Markdown', reply_markup: { force_reply: true } }
                    );
                    return;
                }

                if (state.step === 'WAITING_NAME') {
                    state.data.name = text.trim();
                    state.step = 'WAITING_PHONE';
                    bot.sendMessage(chatId,
                        `📞 *ÉTAPE 3/6*\nQuel est son *NUMÉRO DE TÉLÉPHONE* ?`,
                        { parse_mode: 'Markdown', reply_markup: { force_reply: true } }
                    );
                    return;
                }

                if (state.step === 'WAITING_PHONE') {
                    const phone = text.replace(/\s/g, '');
                    if (!phone.match(/^\d{8,14}$/)) {
                        bot.sendMessage(chatId, "❌ *Numéro invalide !*\nEntrez entre 8 et 14 chiffres (ex: 0661223344).", {
                            parse_mode: 'Markdown', reply_markup: { force_reply: true }
                        });
                        return;
                    }
                    state.data.phone = phone;
                    state.step = 'WAITING_BRAND';
                    bot.sendMessage(chatId,
                        `🏢 *ÉTAPE 4/6*\nQuelle est la *MARQUE / DOMAINE* ? (ou tapez Non)`,
                        { parse_mode: 'Markdown', reply_markup: { force_reply: true } }
                    );
                    return;
                }

                if (state.step === 'WAITING_BRAND') {
                    state.data.brand = (text.toLowerCase() === 'non') ? '' : text.trim();
                    state.step = 'WAITING_PACK';

                    // Build pack list from packs.json
                    const packs = loadPacks();
                    const packLines = Object.values(packs).map(p => `• ${p.nom} — ${p.prix} DA`).join('\n');
                    const isExistant = state.data.category === 'Existant';

                    bot.sendMessage(chatId,
                        `📦 *ÉTAPE 5/6*\nQuel *pack / option* prend ce client ?\n\n${packLines}\n\n${isExistant ? '_(Client existant — précisez l\'option additionnelle)_' : '_(Tapez le nom du pack ou Non)_'}`,
                        { parse_mode: 'Markdown', reply_markup: { force_reply: true } }
                    );
                    return;
                }

                if (state.step === 'WAITING_PACK') {
                    state.data.pack = (text.toLowerCase() === 'non') ? '' : text.trim();
                    state.step = 'WAITING_NOTE';
                    bot.sendMessage(chatId,
                        `📝 *ÉTAPE 6/6*\nUne *OBSERVATION* supplémentaire ? (ou tapez Non)`,
                        { parse_mode: 'Markdown', reply_markup: { force_reply: true } }
                    );
                    return;
                }

                if (state.step === 'WAITING_NOTE') {
                    const note = (text.toLowerCase() === 'non') ? '' : text.trim();
                    const { name, phone, brand, category, pack } = state.data;
                    const addedBy = msg.from.username || msg.from.first_name || 'Inconnu';

                    // Build full note combining pack + note
                    const fullNote = [pack ? `Pack: ${pack}` : '', note].filter(Boolean).join(' | ');

                    try {
                        await addClientManually({ phone, name, brand, note: fullNote, addedBy, category });
                        const categoryIcon = category === 'Existant' ? '🔄' : '✨';
                        bot.sendMessage(chatId,
                            `✅ *CLIENT ENREGISTRÉ !*\n\n` +
                            `${categoryIcon} *Type*: ${category}\n` +
                            `👤 *Nom*: ${name}\n` +
                            `📞 *Tel*: ${phone}\n` +
                            `🏢 *Marque*: ${brand || '-'}\n` +
                            `📦 *Pack/Option*: ${pack || '-'}\n` +
                            `📝 *Note*: ${note || '-'}\n\n` +
                            `➕ *Ajouté par*: @${addedBy}`,
                            { parse_mode: 'Markdown' }
                        );
                    } catch (e) {
                        bot.sendMessage(chatId, "❌ Erreur technique lors de l'enregistrement.");
                    }
                    delete userStates[chatId];
                    return;
                }
            }

            // --- SINGLE MESSAGE SHORTCUT ---
            if (text.includes('-')) {
                const parts = text.split('-').map(p => p.trim()).filter(p => p);
                if (parts.length >= 2) {
                    const phoneIdx = parts.findIndex(p => p.replace(/\s/g, '').match(/^\d{8,14}$/));
                    if (phoneIdx !== -1) {
                        const phone = parts[phoneIdx].replace(/\s/g, '');
                        const name = (phoneIdx === 0) ? (parts[1] || 'Client') : parts[0];
                        const brand = parts[phoneIdx + 1] || '';
                        const note = parts.slice(phoneIdx + 2).join(' - ') || '';
                        const addedBy = msg.from.username || msg.from.first_name || 'Inconnu';
                        
                        try {
                            await addClientManually({ phone, name, brand, note, addedBy });
                            bot.sendMessage(chatId, `✅ **Rapide : Client Enregistré !**\n👤 ${name} (${phone})`);
                        } catch (e) {
                            bot.sendMessage(chatId, "❌ Erreur (Sync Rapide)");
                        }
                        return;
                    }
                }
            }

            // --- PACK / FAQ AUTO-RESPONSE ---
            if (!state) {
                // 1. Secteur détecté → affiche le pack
                const secteur = detectSecteur(text);
                if (secteur) {
                    const pack = formatPack(secteur, lang);
                    if (pack) {
                        await sendWithYoutube(bot, chatId, pack.text, pack.youtube);
                        return;
                    }
                }

                // 2. FAQ matching
                const faqResult = findFaq(text, lang);
                if (faqResult) {
                    if (faqResult.type === 'pack_query') {
                        const reply = lang === 'dz'
                            ? '🏪 Chnou naw3 l-activité taa3ak ?\n\nSupérette / Pharmacie / Boulangerie / Quincaillerie / Industrie / Restaurant ?'
                            : '🏪 Quel est votre type d\'activité ?\n\nSupérette / Pharmacie / Boulangerie / Quincaillerie / Industrie / Restaurant ?';
                        bot.sendMessage(chatId, reply);
                        return;
                    }
                    if (faqResult.type === 'answer') {
                        await sendWithYoutube(bot, chatId, faqResult.text, faqResult.youtube);
                        return;
                    }
                }
            }

            // --- PROMISE AUTO-DETECTION (client reply) ---
            // If this chatId belongs to a known client with a balance, try to parse a payment promise
            if (!state) {
                try {
                    const db = getDB();
                    if (db) {
                        const res = db.exec(
                            `SELECT id, name, negotiatedPrice, paidAmount FROM clients
                             WHERE telegramChatId = '${chatId}' LIMIT 1`
                        );
                        if (res.length) {
                            const cols = res[0].columns;
                            const row = res[0].values[0];
                            const client = {};
                            cols.forEach((c, i) => client[c] = row[i]);
                            const balance = Math.max(0, (client.negotiatedPrice || 0) - (client.paidAmount || 0));

                            if (balance > 0) {
                                const groqKey = getGroqKey();
                                const parsed = await parsePromiseWithGroq(text, groqKey);
                                if (parsed) {
                                    savePaymentPromise(client.id, {
                                        promisedDate:   parsed.promisedDate   || '',
                                        promisedAmount: parsed.promisedAmount  || 0,
                                        promisedMethod: parsed.promisedMethod  || '',
                                        promiseNote:    parsed.promiseNote     || text.slice(0, 200),
                                    });

                                    // Confirm to client
                                    const confirm =
                                        `✅ Merci *${client.name}* ! On a bien noté` +
                                        `${parsed.promisedDate   ? ` la date du *${parsed.promisedDate}*` : ''}` +
                                        `${parsed.promisedAmount ? ` pour *${parsed.promisedAmount.toLocaleString('fr-DZ')} DA*` : ''}` +
                                        `${parsed.promisedMethod ? ` par *${parsed.promisedMethod}*` : ''}` +
                                        `.\n\nNous vous contacterons à cette date. Baraka Llaho fik 🙏`;
                                    bot.sendMessage(chatId, confirm, { parse_mode: 'Markdown' });

                                    // Alert admin
                                    const adminChatId = (() => {
                                        try {
                                            const cfg = JSON.parse(fs.readFileSync(
                                                path.join(app.getPath('userData'), 'telegram-config.json'), 'utf8'
                                            ));
                                            return cfg.adminChatId || null;
                                        } catch(e) { return null; }
                                    })();
                                    if (adminChatId && String(adminChatId) !== String(chatId)) {
                                        const alert =
                                            `🔔 *Promesse de paiement enregistrée automatiquement !*\n\n` +
                                            `👤 Client : *${client.name}*\n` +
                                            `📅 Date : *${parsed.promisedDate || 'non précisée'}*\n` +
                                            `💰 Montant : *${parsed.promisedAmount ? parsed.promisedAmount.toLocaleString('fr-DZ') + ' DA' : 'non précisé'}*\n` +
                                            `💳 Mode : *${parsed.promisedMethod || 'non précisé'}*\n` +
                                            `💬 Ce qu'il a dit : _"${parsed.promiseNote || text}"_`;
                                        bot.sendMessage(adminChatId, alert, { parse_mode: 'Markdown' });
                                    }
                                    return;
                                }
                            }
                        }
                    }
                } catch(e) {
                    console.error('[Bot] Promise detection error:', e.message);
                }
            }

            // --- DEFAULT FALLBACK: ask Groq ---
            if (!state) {
                const groqKey = getGroqKey();
                if (!groqKey) {
                    const fallback = lang === 'dz'
                        ? '❓ Ma fhemtch. Contacti support taa3 LOGICOM.'
                        : '❓ Je n\'ai pas compris. Contactez le support LOGICOM.';
                    bot.sendMessage(chatId, fallback);
                    return;
                }
                const history = chatHistories[chatId] || [];
                bot.sendChatAction(chatId, 'typing');
                try {
                    const reply = await askGroq(text, history);
                    history.push({ role: 'user', content: text });
                    history.push({ role: 'assistant', content: reply });
                    chatHistories[chatId] = history.slice(-20);
                    bot.sendMessage(chatId, reply);
                } catch(e) {
                    bot.sendMessage(chatId, "❌ خطأ تقني: " + e.message);
                }
            }
            } catch(err) {
                console.error('[Bot] Message handler error:', err);
                try { bot.sendMessage(chatId, '❌ Erreur interne. Réessayez.'); } catch(_) {}
            }
        });

        // --- INLINE KEYBOARD CALLBACKS ---
        bot.on('callback_query', async (query) => {
            const chatId = query.message.chat.id;
            const data = query.data;
            try {
                await bot.answerCallbackQuery(query.id);

                // ── RAPPEL FILTER ────────────────────────────────────────────
                if (data.startsWith('rappel_')) {
                    const days = parseInt(data.split('_')[1], 10);
                    const clients = getUnpaidClientsByPeriod(days === 0 ? 99999 : days);

                    if (!clients.length) {
                        const label = days === 0 ? 'tous' : `${days} jours`;
                        bot.sendMessage(chatId, `✅ Aucun client impayé depuis ${label}.`);
                        return;
                    }

                    const label = days === 0 ? 'tous' :
                                  days <= 31  ? `${days} jour(s)` :
                                  days <= 91  ? '3 mois' :
                                  days <= 181 ? '6 mois' :
                                  days <= 241 ? '8 mois' : '1 an';

                    // Store filtered list in state for confirm step
                    userStates[chatId] = { step: 'RAPPEL_CONFIRM', data: { clients, days, label } };

                    const lines = clients.slice(0, 20).map((c, i) =>
                        `${i + 1}. *${c.name}* — ${c.phone}${c.brand ? ` (${c.brand})` : ''}${c.telegramChatId ? ' 📱' : ''}`
                    ).join('\n');
                    const more = clients.length > 20 ? `\n_...et ${clients.length - 20} autres_` : '';
                    const withTelegram = clients.filter(c => c.telegramChatId).length;

                    bot.sendMessage(chatId,
                        `🔔 *${clients.length} clients impayés* depuis ${label} :\n\n${lines}${more}\n\n` +
                        `📱 *${withTelegram}* ont Telegram (recevront le message direct)\n` +
                        `📞 *${clients.length - withTelegram}* sans Telegram (numéros seulement)\n\n` +
                        `Confirmer l'envoi du rappel à tous ?`,
                        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
                            [{ text: '📤 Envoyer rappel à tous', callback_data: 'rappel_send' }],
                            [{ text: '❌ Annuler', callback_data: 'rappel_cancel' }],
                        ]}}
                    );
                    return;
                }

                if (data === 'rappel_cancel') {
                    delete userStates[chatId];
                    bot.sendMessage(chatId, '❌ Rappel annulé.');
                    return;
                }

                if (data === 'rappel_send') {
                    const state = userStates[chatId];
                    if (!state || state.step !== 'RAPPEL_CONFIRM') return;
                    const { clients } = state.data;
                    delete userStates[chatId];

                    const waReady = isWhatsAppReady();
                    let sentTelegram = 0, sentWhatsApp = 0, skipped = 0;
                    const failed = [];

                    for (const client of clients) {
                        const telegramMsg =
                            `👋 Bonjour *${client.name}* !\n\n` +
                            `📋 Un paiement est en attente chez *LOGICOM*.\n\n` +
                            `💰 Merci de régulariser votre situation ou de nous contacter.\n\n` +
                            `📞 Support LOGICOM — نقدرو نعاونك !`;

                        const waMsg =
                            `👋 Bonjour ${client.name} !\n\n` +
                            `📋 Un paiement est en attente chez LOGICOM.\n\n` +
                            `💰 Merci de régulariser votre situation ou de nous contacter.\n\n` +
                            `📞 Support LOGICOM — نقدرو نعاونك !`;

                        let tgSent = false, waSent = false;

                        // Send Telegram if client has chatId
                        if (client.telegramChatId) {
                            try {
                                await bot.sendMessage(client.telegramChatId, telegramMsg, { parse_mode: 'Markdown' });
                                tgSent = true;
                                sentTelegram++;
                            } catch(e) {}
                        }

                        // Send WhatsApp if ready and client has phone
                        if (waReady && client.phone) {
                            try {
                                await sendWhatsApp(client.phone, waMsg);
                                waSent = true;
                                sentWhatsApp++;
                                await new Promise(r => setTimeout(r, 500)); // WhatsApp rate limit
                            } catch(e) {}
                        }

                        if (!tgSent && !waSent) {
                            skipped++;
                            failed.push(`${client.name} — ${client.phone}`);
                        }

                        await new Promise(r => setTimeout(r, 300));
                    }

                    let report =
                        `✅ *Rappels envoyés !*\n\n` +
                        `📱 Telegram : *${sentTelegram}*\n` +
                        `💬 WhatsApp : *${sentWhatsApp}*${!waReady ? ' _(non connecté)_' : ''}\n` +
                        `⚠️ Non atteints : *${skipped}*`;
                    if (failed.length) {
                        report += `\n\n*À contacter manuellement :*\n` + failed.slice(0, 30).map(p => `• ${p}`).join('\n');
                    }
                    bot.sendMessage(chatId, report, { parse_mode: 'Markdown' });
                    return;
                }

                // ── CLIENT TYPE (nouveau / existant) ─────────────────────────
                const state = userStates[chatId];
                if (!state || state.step !== 'WAITING_TYPE') return;

                state.data.category = data === 'type_existant' ? 'Existant' : 'Nouveau';
                state.step = 'WAITING_NAME';

                const icon = state.data.category === 'Existant' ? '🔄' : '✨';
                bot.sendMessage(chatId,
                    `${icon} *Type*: ${state.data.category}\n\n👤 *ÉTAPE 2/6*\nQuel est le *NOM COMPLET* du client ?`,
                    { parse_mode: 'Markdown', reply_markup: { force_reply: true } }
                );
            } catch(e) {
                console.error('[Bot] Callback error:', e);
            }
        });

        console.log('Telegram Bot is now polling...');
    } catch (err) {
        console.error('Critical Telegram initialization error:', err);
    }
}

function updateConfig(newConfig) {
    const configPath = getConfigPath();
    fs.writeFileSync(configPath, JSON.stringify(newConfig));
    initTelegram();
}

function getBot() { return currentBot; }

module.exports = { initTelegram, updateConfig, getBot };

