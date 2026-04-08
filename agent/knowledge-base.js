/**
 * LOGICOM Knowledge Base
 * Contains all product data, pricing, and company info for the AI agent.
 * The agent uses this to answer client questions in Darija.
 */

const DEFAULT_OPTIONS = {
  1: { name: "Achats / Ventes / Reglements / Sauvegardes", price: 45000 },
  2: { name: "Ventes comptoir (superette)", price: 15000 },
  3: { name: "Caisse / Banques", price: 12000 },
  4: { name: "Importation de documents", price: 7000 },
  5: { name: "Familles d'articles", price: 7000 },
  6: { name: "Lots", price: 7000 },
  7: { name: "Numeros de series", price: 11000 },
  8: { name: "2 prix de vente", price: 3500 },
  9: { name: "4 prix de vente", price: 4500 },
  10: { name: "Seuils de stock", price: 3000 },
  11: { name: "Dimensions (tailles/couleurs)", price: 3000 },
  12: { name: "Poids", price: 3000 },
  14: { name: "Liste de colisages", price: 7000 },
  15: { name: "Gestion des entrepots", price: 16000 },
  16: { name: "Gestion des kits", price: 7000 },
  17: { name: "Description articles (photo, document)", price: 8000 },
  19: { name: "Commandes achat et reliquat", price: 7000 },
  20: { name: "Commandes de vente et reliquat", price: 16000 },
  21: { name: "Specialites tiers", price: 4000 },
  22: { name: "Groupes clients", price: 3000 },
  23: { name: "Tableaux de bord (Top 10, Ratios, Graphes)", price: 40000 },
  24: { name: "Utilisation douchette programmable", price: 6000 },
  25: { name: "Echeancier", price: 8000 },
  26: { name: "Importation (module complet)", price: 42000 },
  27: { name: "Calcul des charges directes achats", price: 7000 },
  28: { name: "Gestion des charges", price: 25000 },
  29: { name: "Multi-caisses", price: 16000 },
  30: { name: "Sauvegardes automatiques", price: 6000 },
  34: { name: "Gestion des representants", price: 6000 },
  35: { name: "Carte de fidelite", price: 5000 },
  36: { name: "Balance pour quantites en vrac", price: 5000 },
  39: { name: "Export journaux comptables", price: 5000 },
  40: { name: "Synchronisation WEB", price: 35000 },
  44: { name: "Production / Fabrication", price: 60000 },
  45: { name: "Synchronisation cloud", price: 30000 },
  // Modules
  101: { name: "Poste Reseau", price: 17000 },
  102: { name: "Borne des Prix", price: 6000 },
  103: { name: "Dossiers Supplementaires (35%)", price: 0 },
  104: { name: "Copie Externe pour Consultation (16%)", price: 0 },
  105: { name: "Copie Externe Achats +Tresor.+Etats (30%)", price: 0 },
  106: { name: "Copie Externe Ventes +Tresor.+Etats (30%)", price: 0 },
  107: { name: "Copie Externe pour consolidation inventaire", price: 8000 },
  108: { name: "2eme Dossier dans 2eme PC (consultation)", price: 3000 },
  109: { name: "2eme Dossier dans 2eme PC (copie de modif.)", price: 4000 },
  110: { name: "Transfert de Donnees vers Logicom/exercice", price: 6000 },
  111: { name: "Support Technique / Annee", price: 15000 },
  112: { name: "Activation Poste Secours / 10 Jours", price: 4000 },
  113: { name: "Activation Poste pour Formation / 10 Jours", price: 2000 },
  114: { name: "TSPlus : Systeme Edition", price: 12000 },
  115: { name: "TSPlus : Printer Edition", price: 14000 },
  116: { name: "TSPlus : Web Edition", price: 16000 },
  // Applications mobiles
  201: { name: "App Android Livraison DELYV V2", price: 25000 },
  202: { name: "App Desktop Suivi/Tracking ADMIN-FLOTTE", price: 50000 },
  203: { name: "Poste Supplementaire ADMIN-FLOTTE", price: 7000 },
  204: { name: "App Android Vente Reseau DELPOS V2", price: 13000 },
  205: { name: "App Android d'Inventaire DELINV", price: 7000 },
  206: { name: "App Android d'Achat DELACHA V1", price: 14000 },
  207: { name: "App Android Borne des Prix", price: 5500 },
  208: { name: "App Android Transfert Entrepot DELTRANS", price: 5000 },
  209: { name: "App Desktop Impression Cheques PRINT-CHECK", price: 2500 },
  // Autres logiciels
  301: { name: "Logiciel ABS Mono Dossier", price: 24000 },
  302: { name: "Logiciel ABS Multi Dossiers", price: 30000 },
  303: { name: "Suivi Associes & Bilan Mono Dossier", price: 14000 },
  304: { name: "Suivi Associes & Bilan Multi Dossiers", price: 18000 },
  305: { name: "Suivi Salaires Bilan Mono Dossier", price: 14000 },
  306: { name: "Suivi Salaires Bilan Multi Dossiers", price: 18000 },
};

const DEFAULT_ACTIVITIES = [
  { id: 1, name: "Importation", icon: "🚢", subtitle: "Negoce international & dedouanement", mandatory: [1, 3, 5, 26], optional: [8, 9, 12, 14, 17, 19, 20, 23, 27, 28, 30, 39] },
  { id: 2, name: "Production / Fabrication", icon: "🏭", subtitle: "Industrie, transformation & assemblage", mandatory: [1, 3, 5, 44], optional: [6, 7, 10, 15, 16, 17, 19, 20, 23, 28, 30, 39] },
  { id: 3, name: "Alimentation / Epicerie", icon: "🛒", subtitle: "Produits alimentaires, epices & boissons", mandatory: [1, 3, 5], optional: [6, 8, 9, 10, 17, 20, 22, 23, 24, 28, 30, 36] },
  { id: 4, name: "Papeterie / Fournitures", icon: "✏️", subtitle: "Articles scolaires, imprimerie & bureautique", mandatory: [1, 3, 5], optional: [8, 9, 10, 17, 19, 20, 21, 22, 23, 28, 30, 34] },
  { id: 5, name: "Habillement / Textile", icon: "👕", subtitle: "Pret-a-porter, confection & accessoires", mandatory: [1, 3, 5, 11], optional: [8, 9, 10, 17, 20, 22, 23, 24, 28, 30, 34, 35] },
  { id: 6, name: "Superette / Magasin", icon: "🏪", subtitle: "Libre-service, vente au detail & caisse", mandatory: [1, 2, 3, 5, 24, 29], optional: [8, 9, 10, 17, 22, 23, 28, 30, 35, 36] },
  { id: 7, name: "Pieces Detachees", icon: "⚙️", subtitle: "Automobile, electromenager & mecanique", mandatory: [1, 3, 5, 7], optional: [8, 9, 10, 15, 17, 19, 20, 21, 23, 24, 28, 30] },
  { id: 8, name: "Quincaillerie / Materiaux", icon: "🔨", subtitle: "Batiment, outillage & fournitures industrielles", mandatory: [1, 3, 5, 12], optional: [8, 9, 10, 11, 15, 17, 19, 20, 22, 23, 28, 30, 34] },
];

const COMPANY_INFO = {
  name: "DELFI",
  slogan: "Votre Fidele Partenaire",
  product: "LOGICOM",
  productDesc: "Logiciel de Gestion Commerciale",
  country: "Algerie",
  payment: {
    ccp: "CCP 7240189 cle 02",
    ccpName: "Abbas Bahmed",
    baridiMob: "00799999000724018973",
    methods: ["Cash", "CCP", "Baridi Mob"]
  },
  trial: {
    periods: [7, 15, 30],
    description: "Periode d'essai gratuite avant achat"
  },
  contact: {
    alger: ["+213 (0)23-75-73-57", "+213 (0)23-75-73-60"],
    ouest: ["+213 (0)41 28 40 57", "0552-29-77-49"],
    sud: ["+213 (0)29 26 08 80", "0661-58-01-03"],
    mobile: ["0555-68-79-08"],
  },
  youtube: "https://www.youtube.com/@DELFIVDZ",
  abonnement: "Abonnement annuel pour le support technique et les mises a jour"
};

/**
 * Build the full knowledge base text for injection into the AI system prompt
 */
function buildKnowledgeText(liveOptions, liveActivities) {
  const opts = liveOptions || DEFAULT_OPTIONS;
  const acts = liveActivities || DEFAULT_ACTIVITIES;

  let text = '';

  // Company
  text += `== ENTREPRISE ==\n`;
  text += `Nom: ${COMPANY_INFO.name} - "${COMPANY_INFO.slogan}"\n`;
  text += `Produit: ${COMPANY_INFO.product} (${COMPANY_INFO.productDesc})\n`;
  text += `Pays: ${COMPANY_INFO.country}\n`;
  text += `Paiement: ${COMPANY_INFO.payment.methods.join(', ')}\n`;
  text += `CCP: ${COMPANY_INFO.payment.ccp} - Nom: ${COMPANY_INFO.payment.ccpName}\n`;
  text += `Baridi Mob: ${COMPANY_INFO.payment.baridiMob}\n`;
  text += `Essai gratuit: ${COMPANY_INFO.trial.periods.join(', ')} jours\n`;
  text += `Chaine YouTube (tutoriels): ${COMPANY_INFO.youtube}\n`;
  text += `Tel Alger: ${COMPANY_INFO.contact.alger.join(' / ')}\n`;
  text += `Tel Ouest: ${COMPANY_INFO.contact.ouest.join(' / ')}\n`;
  text += `Tel Sud: ${COMPANY_INFO.contact.sud.join(' / ')}\n`;
  text += `Mobile: ${COMPANY_INFO.contact.mobile.join(' / ')}\n\n`;

  // Options / catalogue
  text += `== CATALOGUE DES OPTIONS (prix en DA) ==\n`;
  const optKeys = Object.keys(opts).map(Number).sort((a, b) => a - b);
  for (const id of optKeys) {
    const o = opts[id];
    const price = o.price > 0 ? `${o.price.toLocaleString('fr-DZ')} DA` : 'selon pourcentage';
    text += `[${id}] ${o.name} — ${price}\n`;
  }

  // Activities / sectors
  text += `\n== SECTEURS D'ACTIVITE ==\n`;
  text += `Chaque secteur a des options obligatoires (incluses) et recommandees (en plus).\n`;
  text += `Les options partagees entre activites ne sont comptees qu'une seule fois.\n\n`;
  for (const act of acts) {
    const mandNames = (act.mandatory || []).map(id => opts[id] ? `${opts[id].name}` : `Opt ${id}`);
    const mandTotal = (act.mandatory || []).reduce((s, id) => s + (opts[id]?.price || 0), 0);
    text += `${act.icon} ${act.name} (${act.subtitle})\n`;
    text += `  Obligatoires: ${mandNames.join(', ')} = ${mandTotal.toLocaleString('fr-DZ')} DA\n`;
    const optTotal = (act.optional || []).reduce((s, id) => s + (opts[id]?.price || 0), 0);
    text += `  Pack complet (avec recommandees): ${(mandTotal + optTotal).toLocaleString('fr-DZ')} DA\n\n`;
  }

  // Tutorials from DELFI YouTube channel
  text += `== TUTORIELS VIDEO (Chaine YouTube DELFI VDZ) ==\n`;
  text += `Lien: https://www.youtube.com/@DELFIVDZ\n`;
  text += `Tous les tutoriels sont gratuits et disponibles en arabe et francais.\n\n`;
  text += `FORMATION COMPLETE LOGICOM (cours numerotes):\n`;
  text += `  1. Introduction Logicom — presentation generale du logiciel\n`;
  text += `  1.1 Creer un Tiers (client/fournisseur) — comment ajouter des partenaires commerciaux\n`;
  text += `  1.2 Creer un Article — comment ajouter des produits au catalogue\n`;
  text += `  1.3 Nouvel Achat — saisir une facture d'achat\n`;
  text += `  1.4 Nouvelle Vente — creer et enregistrer une vente\n`;
  text += `  1.5 Reglement — enregistrer un paiement client ou fournisseur\n`;
  text += `  1.6.1 Recherche Avancee — trouver rapidement des documents et articles\n`;
  text += `  1.6.2 Raccourcis Clavier (principes de base) — navigation rapide\n`;
  text += `  1.6.3 Touche Clavier nouvelles fonctions\n`;
  text += `  1.7.1 Archivage (sauvegarde) — sauvegarder la base de donnees\n`;
  text += `  1.7.2 Consulter une sauvegarde — lire une archive\n`;
  text += `  1.7.3 Restaurer une archive — recuperer des donnees\n`;
  text += `  2.1 Caisse — gestion des operations de caisse\n`;
  text += `  2.2 Banque — gestion des comptes bancaires\n`;
  text += `  3. Importation — module d'importation de marchandises\n\n`;
  text += `VIDEOS SPECIALISEES:\n`;
  text += `  - Point de Vente (POS) — utilisation de la caisse en superette\n`;
  text += `  - Raccourcis Clavier de Logicom — liste complete des raccourcis\n`;
  text += `  - Questions frequemment posees (FAQ video) — reponses aux questions courantes de debut d'annee\n`;
  text += `  - Procedure d'inventaire — comment faire le jord (inventaire) du stock\n`;
  text += `  - Ajout de photo a un article — illustrer les produits\n`;
  text += `  - Application Mobile Inventaire (DELINV) — faire l'inventaire sur telephone\n`;
  text += `  - Video Archive (avant 5 ans) — consulter les anciennes donnees\n`;
  text += `  - Abonnement Annuel — comment renouveler son abonnement support\n\n`;

  // FAQ
  text += `== FAQ ==\n`;
  text += `- LOGICOM c'est quoi? Un logiciel de gestion commerciale pour les entreprises algeriennes, fait par DELFI.\n`;
  text += `- Il gere quoi? Achats, ventes, stock, caisse, banque, factures, clients, fournisseurs, tableaux de bord, inventaire.\n`;
  text += `- C'est pour quel secteur? Importation, production, alimentation, textile, quincaillerie, superette, pieces detachees, papeterie.\n`;
  text += `- Ya des apps mobile? Oui: DELYV (livraison), DELPOS (vente), DELINV (inventaire), DELACHA (achat), DELTRANS (transfert entrepot).\n`;
  text += `- Combien ca coute? Ca depend du secteur. Le pack de base commence a ~64,000 DA.\n`;
  text += `- Ya un essai gratuit? Oui, 7, 15 ou 30 jours.\n`;
  text += `- Comment payer? Cash, CCP (7240189 cle 02, Abbas Bahmed), ou Baridi Mob (00799999000724018973).\n`;
  text += `- Support technique? 15,000 DA/an (abonnement annuel).\n`;
  text += `- Reseau? Oui, poste reseau a 17,000 DA par poste.\n`;
  text += `- Cloud? Oui, synchronisation cloud a 30,000 DA.\n`;
  text += `- Comment faire une sauvegarde? Voir la video tutorial "Archivage" sur la chaine YouTube DELFI VDZ.\n`;
  text += `- Comment faire l'inventaire? Voir la video "Procedure d'inventaire" sur YouTube. Y'a aussi l'app mobile DELINV (7,000 DA).\n`;
  text += `- Comment utiliser le point de vente? Voir la video "Point de Vente" sur YouTube. Option "Ventes comptoir" a 15,000 DA.\n`;
  text += `- Comment creer un article? Voir la video "Creer Article" sur YouTube (tutorial 1.2).\n`;
  text += `- Comment faire un reglement? Voir la video "Reglement" sur YouTube (tutorial 1.5).\n`;
  text += `- Wach kayen raccourcis clavier? Oui! Voir les videos "Raccourcis Clavier" sur YouTube.\n`;
  text += `- Comment contacter DELFI? Tel Alger: 023-75-73-57, Ouest: 041-28-40-57, Sud: 029-26-08-80, Mobile: 0555-68-79-08.\n`;
  text += `- Wach kayen formation? Oui, formation complete gratuite sur YouTube (chaine DELFI VDZ) + formation sur site possible.\n`;

  return text;
}

module.exports = { DEFAULT_OPTIONS, DEFAULT_ACTIVITIES, COMPANY_INFO, buildKnowledgeText };
