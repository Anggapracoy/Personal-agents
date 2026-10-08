import { z } from 'zod';
const text=z.string().max(2000);
const selector=z.object({ref:z.string().regex(/^e\d+$/).optional(),css:text.optional(),role:text.optional(),name:text.optional(),text:text.optional(),label:text.optional(),placeholder:text.optional(),testId:text.optional(),hasText:text.optional(),exact:z.boolean().optional(),visible:z.boolean().optional(),index:z.number().int().min(-1).max(199).optional()}).refine(q=>Object.keys(q).some(k=>k!=='exact'),'Provide a locator');
export const locatorSchema=selector.and(z.object({scopes:z.array(selector).max(8).optional(),frame:text.optional(),index:z.number().int().min(-1).max(199).optional()}));
export const extendedBrowserSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('query'),locator:locatorSchema,poll:z.object({state:z.enum(['attached','visible','hidden','enabled']),timeoutMs:z.number().finite().min(0).max(20000)}).optional()}),
 z.object({action:z.literal('evaluate'),expression:z.string().min(1).max(12000)}),
 z.object({action:z.enum(['forward','reload','tabs_list','tabs_new','logs','clipboard_read'])}),
 z.object({action:z.enum(['tabs_select','tabs_close']),id:z.string().min(1).max(200)}),
 z.object({action:z.literal('dialog'),accept:z.boolean(),text:z.string().max(2000).optional(),purpose:z.string().min(1).max(500),requiresApproval:z.boolean()}),
 z.object({action:z.literal('clipboard_write'),text:z.string().max(10000)}),
 z.object({action:z.literal('upload'),ref:z.string().regex(/^e\d+$/),files:z.array(z.object({artifactId:z.string().min(1).max(100)})).min(1).max(5)}),
 z.object({action:z.literal('download'),url:z.url(),name:z.string().regex(/^[A-Za-z0-9._-]{1,120}$/),purpose:z.string().min(1).max(500)}),
]);
