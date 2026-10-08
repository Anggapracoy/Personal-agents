import assert from "node:assert/strict";
import test from "node:test";
import { createScreenNavigation } from "../app/screen-navigation";
function setup() {
  const visible: string[] = [], history: string[] = [];
  const nav = createScreenNavigation({ initial: "home", parent: () => "home", show: (s: string) => visible.push(s), pushHistory: () => history.push("push"), backHistory: () => history.push("back") });
  return { nav, visible, history };
}
test("Settings and back render before browser history responds", () => {
  const { nav, visible, history } = setup();
  nav.open("settings"); assert.deepEqual(visible, ["settings"]);
  nav.back(); assert.deepEqual(visible, ["settings", "home"]);
  assert.deepEqual(history, ["push", "back"]);
  nav.popped(); assert.deepEqual(visible, ["settings", "home"]);
});
test("rapid back taps are immediate and acknowledgements do not double-pop", () => {
  const { nav, visible, history } = setup();
  nav.open("settings"); nav.open("account"); nav.back(); nav.back();
  assert.deepEqual(visible, ["settings", "account", "settings", "home"]);
  assert.deepEqual(history, ["push", "push", "back"]);
  nav.popped(); assert.deepEqual(history, ["push", "push", "back", "back"]);
  nav.popped(); assert.equal(visible.length, 4);
});
test("opening a screen during a pending back retains correct history order", () => {
  const { nav, visible, history } = setup();
  nav.open("settings"); nav.back(); nav.open("chat");
  assert.equal(visible.at(-1), "chat");
  assert.deepEqual(history, ["push", "back"]);
  nav.popped(); assert.deepEqual(history, ["push", "back", "push"]);
  nav.popped(); assert.equal(visible.at(-1), "home");
});
test("browser back without an app back still pops one screen", () => {
  const { nav, visible } = setup();
  nav.open("settings"); nav.open("account");
  nav.popped(); assert.equal(visible.at(-1), "settings");
  nav.popped(); assert.equal(visible.at(-1), "home");
});
