/** Paint local navigation immediately; browser history acknowledges back asynchronously. */
export function createScreenNavigation<Screen>(input: {
  initial: Screen;
  parent: (screen: Screen) => Screen;
  show: (screen: Screen, direction: "push" | "pop") => void;
  pushHistory: () => void;
  backHistory: () => void;
}) {
  let current = input.initial;
  const stack: Screen[] = [];
  const historyQueue: Array<"push" | "back"> = [];
  let awaitingPop = false;
  const show = (screen: Screen, direction: "push" | "pop" = "pop") => { current = screen; input.show(screen, direction); };
  const flush = () => {
    while (!awaitingPop && historyQueue.length) {
      const operation = historyQueue.shift();
      if (operation === "push") input.pushHistory();
      else { awaitingPop = true; input.backHistory(); }
    }
  };
  return {
    open(next: Screen) {
      stack.push(current);
      show(next, "push");
      historyQueue.push("push");
      flush();
    },
    back() {
      if (!stack.length) { show(input.parent(current)); return; }
      show(stack.pop()!);
      historyQueue.push("back");
      flush();
    },
    popped() {
      if (awaitingPop) {
        // This acknowledges a back already painted. Do not pop the UI twice.
        awaitingPop = false;
        flush();
      } else show(stack.pop() ?? input.parent(current));
    },
  };
}
