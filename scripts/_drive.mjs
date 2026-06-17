// Drives N paid "thinks" through the real path: gateway 402 -> executor /sign-payment -> gateway 200.
// Proves the fee path + treasury fix end-to-end. Settlement is batched (10 or 60s), so we then poll.
const GW = 'http://127.0.0.1:8402';
const EX = 'http://127.0.0.1:8404';
const body = JSON.stringify({ model: 'llama3', messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 });
const N = Number(process.argv[2] ?? 3);

const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };

// 1) get the 402 challenge
const ch = await fetch(`${GW}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Agent-Id': '0' }, body });
console.log('challenge status', ch.status);
const challenge = await j(ch);
const req = challenge?.accepts?.[0];
if (!req) { console.log('no accepts[0]:', challenge); process.exit(1); }
console.log('payTo(treasury)=', req.payTo, ' amount=', req.maxAmountRequired ?? req.amount ?? '(see req)', ' asset=', req.asset);

// 2) N rounds of sign + pay
for (let i = 1; i <= N; i++) {
  const s = await fetch(`${EX}/sign-payment`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentId: '0', paymentRequirements: req }) });
  const signed = await j(s);
  if (!signed?.xPayment) { console.log(`think ${i}: sign failed`, s.status, signed); break; }
  const p = await fetch(`${GW}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Agent-Id': '0', 'X-PAYMENT': signed.xPayment }, body });
  const xpr = p.headers.get('x-payment-response');
  const rb = await j(p);
  console.log(`think ${i}: HTTP ${p.status}` + (xpr ? `  settle=${JSON.parse(Buffer.from(xpr, 'base64').toString()).settlement}` : '') + (p.status !== 200 ? `  body=${JSON.stringify(rb).slice(0,300)}` : ''));
  if (i === 1) console.log('  xPayment(head)=', String(signed.xPayment).slice(0, 80));
}
console.log('done driving', N, 'thinks; settlement batches at 10 or 60s.');
