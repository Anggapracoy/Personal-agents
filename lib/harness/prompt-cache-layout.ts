type PromptEntry = {
  role: string;
  providerOptions?: Record<string, Record<string, unknown>>;
};

export const runtimeContextOptions = { dash: { runtimeContext: true } } as const;

/**
 * The SDK prepends instructions on every step. Move only our marked, current
 * runtime instructions behind the history at the provider boundary. Keep their
 * system/developer priority, and leave the SDK's durable messages untouched.
 */
export function runtimeContextAfterHistory<T extends PromptEntry>(prompt: T[]): T[] {
  const isRuntime = (message: T) => message.role === "system"
    && message.providerOptions?.dash?.runtimeContext === true;
  const runtime = prompt.filter(isRuntime);
  if (!runtime.length) return prompt;
  return [...prompt.filter(message => !isRuntime(message)), ...runtime];
}
