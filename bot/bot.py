import json
import os
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ApplicationBuilder, MessageHandler, CommandHandler, filters, ContextTypes

BOT_TOKEN  = "YOUR_TELEGRAM_BOT_TOKEN"   # ← remplace ici
PACKS_FILE = os.path.join(os.path.dirname(__file__), "packs.json")

# ── Mots-clés secteurs ────────────────────────────────────────────────────────
SECTEUR_KEYWORDS = {
    "superette":     ["superette", "supérette", "epicerie", "épicerie", "magasin", "hanout", "supermarche"],
    "pharmacie":     ["pharmacie", "medicament", "médicament", "ordonnance", "pharmacien", "saidliya"],
    "boulangerie":   ["boulangerie", "patisserie", "pâtisserie", "pain", "gateau", "gâteau", "khobz"],
    "quincaillerie": ["quincaillerie", "materiaux", "matériaux", "ferronnerie", "outillage", "hdida"],
    "industrie":     ["industrie", "usine", "fabrication", "production", "atelier", "masna3"],
    "restaurant":    ["restaurant", "cafe", "café", "snack", "pizzeria", "brasserie", "mat3am", "kahwa"],
}

# ── FAQ ───────────────────────────────────────────────────────────────────────
FAQ = [
    {
        "keywords_fr":     ["prix", "tarif", "pack", "combien", "abonnement", "coûte"],
        "keywords_darija": ["qaddach", "qadech", "taman", "pack", "flous", "bchhal"],
        "is_pack_query":   True,
    },
    {
        "keywords_fr":     ["installer", "installation", "télécharger", "setup"],
        "keywords_darija": ["install", "nsob", "rockeb", "setup", "tanzil"],
        "answer_fr":       "⚙️ Pour installer :\n1. Téléchargez le setup\n2. Lancez en administrateur\n3. Suivez les étapes\n\nTutoriel :",
        "answer_darija":   "⚙️ Bach t-install :\n1. Nzal setup\n2. D-marré ki administrateur\n3. Sib l-étapes\n\nTutorial :",
        "youtube_url":     "https://youtu.be/VOTRE_VIDEO_INSTALLATION",
    },
    {
        "keywords_fr":     ["facture", "devis", "facturation"],
        "keywords_darija": ["facture", "fatura", "devis"],
        "answer_fr":       "🧾 Créer une facture :\nMenu → Ventes → Nouvelle facture\n\nTutoriel :",
        "answer_darija":   "🧾 Bach dir facture :\nMenu → Ventes → Facture jadida\n\nTutorial :",
        "youtube_url":     "https://youtu.be/VOTRE_VIDEO_FACTURATION",
    },
    {
        "keywords_fr":     ["stock", "inventaire", "produit", "article"],
        "keywords_darija": ["stock", "inventaire", "produit", "makhzen"],
        "answer_fr":       "📦 Gestion stock :\nMenu → Stock → Bon d'entrée / Bon de sortie\n\nTutoriel :",
        "answer_darija":   "📦 Gestion stock :\nMenu → Stock → Bon d'entrée / Bon de sortie\n\nTutorial :",
        "youtube_url":     "https://youtu.be/VOTRE_VIDEO_STOCK",
    },
    {
        "keywords_fr":     ["bug", "erreur", "problème", "marche pas", "bloque"],
        "keywords_darija": ["bug", "mochkil", "ma khdamch", "bloqué", "yetblok"],
        "answer_fr":       "🛠️ Problème technique :\n1. Fermez et relancez\n2. Vérifiez le réseau\n\nSi persiste → contactez le support",
        "answer_darija":   "🛠️ Mochkil technique :\n1. Saker w 3awed iftah\n2. Chek réseau\n\nIla mzal → contacti support",
        "youtube_url":     None,
    },
]

FALLBACK_FR     = "❓ Je n'ai pas compris. Contactez notre support LOGICOM."
FALLBACK_DARIJA = "❓ Ma fhemtch. Contacti support taa3 LOGICOM."
WELCOME_FR      = (
    "👋 Bonjour ! Bienvenue chez LOGICOM 🇩🇿\n\n"
    "Quel type d'activité avez-vous ?\n\n"
    "🏪 Supérette  💊 Pharmacie  🥖 Boulangerie\n"
    "🔧 Quincaillerie  🏭 Industrie  🍕 Restaurant\n\n"
    "Ou posez directement votre question !"
)
WELCOME_DARIJA  = (
    "👋 Salam ! Marhba bik f LOGICOM 🇩🇿\n\n"
    "Chnou naw3 l-activité taa3ak ?\n\n"
    "🏪 Supérette  💊 Pharmacie  🥖 Boulangerie\n"
    "🔧 Quincaillerie  🏭 Industrie  🍕 Restaurant\n\n"
    "Wella soel s-so2al taa3ak !"
)

# ── Helpers ───────────────────────────────────────────────────────────────────
def load_packs() -> dict:
    """Relit packs.json à chaque appel — toujours à jour sans redémarrer."""
    try:
        with open(PACKS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}

def detect_language(text: str) -> str:
    text = text.lower()
    darija_signals = [
        "salam", "wach", "labas", "nta", "nti", "rahi", "raha", "rani",
        "ndir", "nchof", "3lach", "kifach", "taa3i", "taa3ak", "taa3na",
        "bezzaf", "chwiya", "safi", "wakha", "mzyan", "machi", "qaddach",
        "qadech", "bach", "3ndek", "3ndi", "kayen", "kayna", "daba", "druk",
        "mochkil", "ya khoya", "ya khti", "bchhal", "mat3am", "kahwa",
    ]
    score = sum(1 for s in darija_signals if s in text)
    if any('\u0600' <= c <= '\u06ff' for c in text):
        score += 3
    return "darija" if score >= 1 else "french"

def detect_secteur(text: str):
    text = text.lower()
    for secteur, keywords in SECTEUR_KEYWORDS.items():
        if any(kw in text for kw in keywords):
            return secteur
    return None

def format_pack(secteur: str, lang: str):
    """Retourne (message, youtube_url) ou (None, None) si introuvable."""
    packs = load_packs()
    if secteur not in packs:
        return None, None
    p = packs[secteur]
    inclus = "\n".join(f"  ✅ {item}" for item in p["inclus"])
    if lang == "darija":
        msg = (
            f"🎯 *{p['nom']}*\n\n"
            f"💰 Prix : *{p['prix']} DA*\n\n"
            f"Chnou kayen f-pack :\n{inclus}\n\n"
            f"Bach tachri wella t3allem aktar, contacti-na ! 📞"
        )
    else:
        msg = (
            f"🎯 *{p['nom']}*\n\n"
            f"💰 Prix : *{p['prix']} DA*\n\n"
            f"Ce pack inclut :\n{inclus}\n\n"
            f"Pour acheter ou en savoir plus, contactez-nous ! 📞"
        )
    return msg, p.get("youtube")

def find_faq(text: str, lang: str):
    """Retourne ('PACK_QUERY', None) | (answer, youtube) | (None, None)."""
    text_low = text.lower()
    kw_key  = "keywords_darija" if lang == "darija" else "keywords_fr"
    ans_key = "answer_darija"   if lang == "darija" else "answer_fr"
    for entry in FAQ:
        if any(kw in text_low for kw in entry[kw_key]):
            if entry.get("is_pack_query"):
                return "PACK_QUERY", None
            return entry.get(ans_key, ""), entry.get("youtube_url")
    return None, None

# ── Handlers ──────────────────────────────────────────────────────────────────
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    lang = detect_language(update.message.text or "")
    await update.message.reply_text(WELCOME_DARIJA if lang == "darija" else WELCOME_FR)

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = update.message.text or ""
    lang = detect_language(text)

    # 1. Secteur détecté → affiche le pack
    secteur = detect_secteur(text)
    if secteur:
        msg, youtube_url = format_pack(secteur, lang)
        if msg:
            kb = [[InlineKeyboardButton("▶ Voir tutoriel / Chof tutorial", url=youtube_url)]] if youtube_url else None
            await update.message.reply_text(
                msg,
                parse_mode="Markdown",
                reply_markup=InlineKeyboardMarkup(kb) if kb else None
            )
            return

    # 2. FAQ
    answer, youtube_url = find_faq(text, lang)

    if answer == "PACK_QUERY":
        reply = (
            "🏪 Chnou naw3 l-activité taa3ak ?\n\nSupérette / Pharmacie / Boulangerie / Quincaillerie / Industrie / Restaurant ?"
            if lang == "darija" else
            "🏪 Quel est votre type d'activité ?\n\nSupérette / Pharmacie / Boulangerie / Quincaillerie / Industrie / Restaurant ?"
        )
        await update.message.reply_text(reply)
        return

    if answer:
        kb = [[InlineKeyboardButton("▶ Voir tutoriel / Chof tutorial", url=youtube_url)]] if youtube_url else None
        await update.message.reply_text(
            answer,
            reply_markup=InlineKeyboardMarkup(kb) if kb else None
        )
        return

    # 3. Fallback
    await update.message.reply_text(FALLBACK_DARIJA if lang == "darija" else FALLBACK_FR)

# ── Main ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    application = ApplicationBuilder().token(BOT_TOKEN).build()
    application.add_handler(CommandHandler("start", start))
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))
    print("✅ LOGICOM Bot démarré...")
    application.run_polling()
