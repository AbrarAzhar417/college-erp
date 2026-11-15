import { getSetting, setSetting } from '../db.js';

/**
 * Reading handwriting from a photo needs a vision AI. This program has none inside, so it asks the Claude API (the college's own key,
 * set in System & Safety → Photo reading, or the ANTHROPIC_API_KEY environment variable). The photo leaves the college computer for that
 * request, nothing else does. Every result is shown to a person first; nothing is saved without confirmation.
 */
export const apiKey = () => process.env.ANTHROPIC_API_KEY || getSetting('vision_api_key') || '';
export const visionReady = () => !!apiKey();
export const saveApiKey = (k: string) => setSetting('vision_api_key', k.trim());

export type Mime = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
export function sniffImage(b: Buffer): Mime | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (b.subarray(0, 3).toString('latin1') === 'GIF') return 'image/gif';
  return null;
}

let doFetch: typeof fetch = (...a) => fetch(...a);
export const setVisionFetch = (f: typeof fetch) => { doFetch = f; };

const hits = new Map<number, number[]>();
/** At most 40 photos per person per hour: a slip cannot run up a bill. */
export function allowScan(userId: number, limit = 40): boolean {
  const now = Date.now(), l = (hits.get(userId) ?? []).filter(t => now - t < 3600_000);
  if (l.length >= limit) { hits.set(userId, l); return false; }
  l.push(now); hits.set(userId, l); return true;
}

export class VisionError extends Error {}

/** Sends one photo with an instruction and returns the JSON object the model answered with. */
export async function readImage(img: Buffer, mime: Mime, instruction: string): Promise<any> {
  const key = apiKey(); if (!key) throw new VisionError('Photo reading is not set up. The Director can add the API key in System & Safety → Photo reading.');
  let r: Response;
  try {
    r = await doFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: process.env.ERP_VISION_MODEL || 'claude-sonnet-5-5', max_tokens: 4000,
        messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mime, data: img.toString('base64') } }, { type: 'text', text: instruction }] }]
      })
    });
  } catch { throw new VisionError('Could not reach the photo-reading service. Check the internet connection of the college computer.'); }
  if (r.status === 401 || r.status === 403) throw new VisionError('The photo-reading key was refused. Check the key in System & Safety → Photo reading.');
  if (r.status === 429) throw new VisionError('The photo-reading service is busy. Try again in a minute.');
  if (!r.ok) throw new VisionError(`The photo-reading service answered with an error (${r.status}).`);
  const data: any = await r.json().catch(() => null);
  const text: string = (data?.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) throw new VisionError('The photo could not be read. Take it again: flat, well lit, the whole page in view.');
  try { return JSON.parse(m[0]); } catch { throw new VisionError('The photo could not be read. Take it again: flat, well lit, the whole page in view.'); }
}

export const marksPrompt = (max: number, subject: string) => `This is a photo of a handwritten school marks sheet (award list) for the subject "${subject}". Maximum marks are ${max}.
Read every student row. Answer with ONLY this JSON, no other text:
{"rows":[{"roll_no":"","adm_no":"","name":"","marks":"","status":""}]}
Rules: copy roll_no, adm_no and name exactly as printed or written. "marks" is the number written for that student (digits only, keep decimals such as 17.5). If the student is marked absent write "A" in status and leave marks empty; leave on leave "L". If the marks box is empty or you cannot read it with confidence, leave marks empty. Never guess and never invent rows that are not on the page.`;

export const admissionPrompt = `This is a photo of a filled school admission form (handwritten or typed). Read the fields you can see. Answer with ONLY this JSON, no other text; use "" for anything missing or unreadable:
{"name":"","father_name":"","father_cnic":"","dob":"","gender":"","phone":"","father_phone":"","mother_phone":"","address":"","class":"","p_number":"","previous_school":""}
Rules: dob as YYYY-MM-DD; gender as "Male" or "Female"; father_cnic as 13 digits with dashes like 35202-1234567-1; phones as written. Never guess a value you cannot read.`;
