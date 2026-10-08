import { z } from "zod";
export const easterEggEventSchema = z.object({ id: z.string().uuid(), requestMessageId: z.string(), createdAt: z.string().datetime(), effect: z.enum(["confetti", "disco", "snow", "flip", "67"]).default("confetti") });
export type EasterEggEvent = z.infer<typeof easterEggEventSchema>;
