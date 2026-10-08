import { z } from "zod";

export const emailDraftEditSchema = z.object({
  subject: z.string().min(1).max(300).refine(value => value.trim().length > 0 && !/[\r\n]/.test(value)),
  body: z.string().min(1).max(30000).refine(value => value.trim().length > 0),
}).strict();

/** Preserve recipients and reply headers; replace only the approved plain-text content. */
export function editedDraftRaw(raw: string, edit: z.infer<typeof emailDraftEditSchema>) {
  const validated = emailDraftEditSchema.parse(edit);
  const message = Buffer.from(raw, 'base64url').toString('utf8');
  const boundary = message.search(/\r?\n\r?\n/);
  if (boundary < 0) throw new Error('The email draft could not be read. Nothing was sent.');
  const headers = message.slice(0, boundary).replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/);
  const contentType = headers.find(line => /^Content-Type:/i.test(line));
  if (contentType && !/^Content-Type:\s*text\/plain(?:\s*;|\s*$)/i.test(contentType)) throw new Error('This draft format cannot be edited inline. Nothing was sent.');
  const retained = headers.filter(line => !/^(Subject|Content-Type|Content-Transfer-Encoding|Content-Length):/i.test(line));
  return Buffer.from([...retained,
    `Subject: =?UTF-8?B?${Buffer.from(validated.subject).toString('base64')}?=`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64', '', Buffer.from(validated.body).toString('base64'),
  ].join('\r\n')).toString('base64url');
}
