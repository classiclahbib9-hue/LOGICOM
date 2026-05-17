/**
 * promise-parser.js
 * Uses Groq (free) to extract payment promise details from a client's free-text reply.
 * Works for Darija, French, or mixed messages.
 */

const https = require('https');

const PARSE_PROMPT = `Tu es un assistant qui extrait des informations de promesse de paiement depuis un message client.
Retourne UNIQUEMENT un objet JSON valide avec ces champs (rien d'autre, pas de markdown, pas d'explication) :
{
  "isPromise": true/false,
  "promisedDate": "YYYY-MM-DD ou null",
  "promisedAmount": nombre ou null,
  "promisedMethod": "Espèces|Virement|Chèque|BaridiMob|CCP ou null",
  "promiseNote": "résumé court de ce que le client a dit"
}

Règles :
- isPromise = true si le client mentionne une date, un montant, ou un mode de paiement futur
- Pour les dates relatives (demain, vendredi, la semaine prochaine, غدا, جمعة...) convertis en YYYY-MM-DD par rapport à aujourd'hui : ${new Date().toISOString().split('T')[0]}
- promisedMethod : détecte chèque, virement, espèces, cash, BaridiMob, CCP, داريجة (فلوس نقدا، شيك، تحويل)
- Si aucun montant n'est mentionné, retourne null pour promisedAmount
- promiseNote : résume en 1 phrase ce que le client a dit`;

function parsePromiseWithGroq(clientMessage, groqApiKey) {
    return new Promise((resolve) => {
        if (!groqApiKey || !clientMessage) {
            return resolve(null);
        }

        const messages = [
            { role: 'system', content: PARSE_PROMPT },
            { role: 'user', content: clientMessage }
        ];
        const body = JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            max_tokens: 200,
            temperature: 0,
            messages
        });

        const req = https.request({
            hostname: 'api.groq.com',
            path: '/openai/v1/chat/completions',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + groqApiKey,
                'Content-Length': Buffer.byteLength(body)
            }
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    const content = json.choices?.[0]?.message?.content || '{}';
                    // Strip any markdown code fences just in case
                    const clean = content.replace(/```json?/g, '').replace(/```/g, '').trim();
                    const parsed = JSON.parse(clean);
                    resolve(parsed.isPromise ? parsed : null);
                } catch(e) {
                    resolve(null);
                }
            });
        });
        req.on('error', () => resolve(null));
        req.write(body);
        req.end();
    });
}

module.exports = { parsePromiseWithGroq };
