import { AsyncLocalStorage } from 'node:async_hooks';
import { parse, type Node } from 'acorn';

const scope = new AsyncLocalStorage<boolean>();
export const isBrowserObservationDiscarded = () => scope.getStore() === true;
export const withDiscardedBrowserObservation = <T>(discarded: boolean, work: () => Promise<T>) => scope.run(discarded, work);

type Ast = Node & Record<string, any>;
function children(node: Ast): Ast[] {
  return Object.values(node).flatMap(value => Array.isArray(value) ? value.filter(item => item?.type) : value?.type ? [value] : []);
}
function all(node: Ast): Ast[] { return [node, ...children(node).flatMap(all)]; }
function method(node: Ast): string | undefined {
  return node?.type === 'CallExpression' && !node.optional && node.callee.type === 'MemberExpression' && !node.callee.computed && !node.callee.optional ? node.callee.property.name : undefined;
}
/** Only straight-line, statically recognizable facade code qualifies. A discarded
 * wait/click immediately followed by a fresh observation/read need not build an
 * intermediate AX tree. Consecutive unused literal fills can share their final
 * observation. The final read and all input safeguards remain intact. */
export function compileDiscardedObservations(code: string): string {
  let tree: Ast;
  try { tree = parse(code, { ecmaVersion: 'latest', allowAwaitOutsideFunction: true }) as Ast; }
  catch { return code; }
  const nodes = all(tree);
  if (nodes.some(n => /Function|Class|Assignment|Update|Import|NewExpression|WithStatement|TaggedTemplate/.test(n.type)
    || n.type === 'Identifier' && n.name === '__discardBrowserObservation')) return code;
  const pages = new Set<string>();
  for (const statement of tree.body) {
    if (statement.type !== 'VariableDeclaration' || statement.kind !== 'const') continue;
    for (const d of statement.declarations) if (d.id.type === 'Identifier' && method(d.init) === 'page'
      && d.init.callee.object.type === 'Identifier' && d.init.callee.object.name === 'browser' && d.init.arguments.length === 0) pages.add(d.id.name);
  }
  const page = (n: Ast) => n?.type === 'Identifier' && pages.has(n.name);
  const locator = (n: Ast): boolean => page(n) || Boolean(method(n) && ['getByRole','getByText','getByLabel','getByPlaceholder','getByTestId','locator','ref','filter','nth','first','last'].includes(method(n)!) && locator(n.callee.object));
  const keyboard = (n: Ast): boolean => n?.type === "MemberExpression" && !n.computed && !n.optional && n.property.name === "keyboard" && page(n.object);
  // Unknown calls could mutate a page's methods or run hidden browser actions.
  if (nodes.some(n => n.type === 'CallExpression' && !(n.callee.type === 'Identifier' && n.callee.name === 'print')
    && !(method(n) === 'page' && n.callee.object.name === 'browser')
    && !locator(n.callee.object) && !keyboard(n.callee.object) && method(n) !== 'slice')) return code;
  const rootPage = (node:Ast):string|undefined => page(node) ? node.name : method(node) ? rootPage(node.callee.object) : undefined;
  const plainFill = (call:Ast):boolean => method(call)==='fill' && !page(call.callee.object) && locator(call.callee.object)
    && call.arguments.length>=1 && call.arguments.length<=2 && call.arguments[0].type==='Literal' && typeof call.arguments[0].value==='string'
    && (!call.arguments[1] || call.arguments[1].type==='ObjectExpression' && call.arguments[1].properties.every((p:Ast)=>
      p.type==='Property' && p.kind==='init' && !p.computed && (p.key.name ?? p.key.value)==='purpose' && p.value.type==='Literal' && typeof p.value.value==='string'));
  const edits: Array<{start:number;end:number;text:string}> = [];
  for (let i=0;i<tree.body.length-1;i++) {
    const statement=tree.body[i], next=tree.body[i+1];
    if (statement.type!=='ExpressionStatement' || statement.expression.type!=='AwaitExpression') continue;
    const call=statement.expression.argument, name=method(call);
    const keyboardCall = (n: Ast, key: string) => method(n) === key && keyboard(n.callee.object)
      && n.arguments.length >= 1 && n.arguments.length <= 2 && n.arguments[0].type === 'Literal' && typeof n.arguments[0].value === 'string'
      && (!n.arguments[1] || n.arguments[1].type === 'ObjectExpression' && n.arguments[1].properties.every((p: Ast) => p.type === 'Property' && p.kind === 'init' && !p.computed && p.value.type === 'Literal' && ((p.key.name ?? p.key.value) === 'purpose' && typeof p.value.value === 'string' || (p.key.name ?? p.key.value) === 'requiresApproval' && p.value.value === false)));
    const following = next.type === 'ExpressionStatement' && next.expression.type === 'AwaitExpression' ? next.expression.argument
      : next.type === 'VariableDeclaration' && next.kind === 'const' && next.declarations.length === 1 && next.declarations[0].init?.type === 'AwaitExpression' ? next.declarations[0].init.argument : undefined;
    if (keyboardCall(call, 'type') && keyboardCall(following, 'press') && call.callee.object.object.name === following.callee.object.object.name) {
      edits.push({start:statement.expression.start,end:statement.expression.end,text:`await __discardBrowserObservation(async()=>(${code.slice(statement.expression.start,statement.expression.end)}))`});
      continue;
    }
    if (name==='fill' && plainFill(call) && next.type==='ExpressionStatement' && next.expression.type==='AwaitExpression'
      && plainFill(next.expression.argument) && rootPage(call.callee.object)===rootPage(next.expression.argument.callee.object)) {
      // The next predetermined fill resolves its own target freshly; its normal
      // observation (or the end of this chain) covers the completed form.
      edits.push({start:statement.expression.start,end:statement.expression.end,text:`await __discardBrowserObservation(async()=>(${code.slice(statement.expression.start,statement.expression.end)}))`});
      continue;
    }
    if (name!=='wait' && name!=='click') continue;
    if (!locator(call.callee.object)) continue;
    if (name==='wait' && (!page(call.callee.object) || call.arguments.length!==1 || call.arguments[0].type!=='Literal' || typeof call.arguments[0].value!=='number')) continue;
    // Literal options only: no getters, spread, callbacks or hidden side effects.
    if (name==='click' && (call.arguments.length>1 || (call.arguments[0] && (call.arguments[0].type!=='ObjectExpression'
      || call.arguments[0].properties.some((p:Ast)=>p.type!=='Property'||p.kind!=='init'||p.computed||p.value.type!=='Literal'))))) continue;
    const awaits=all(next).filter(n=>n.type==='AwaitExpression');
    if (awaits.length!==1) continue;
    const observer=awaits[0].argument, observing=method(observer);
    const locatorRead = ['innerText','allTextContents','count','isVisible','isEnabled','isChecked','boundingBox','getAttribute'].includes(observing ?? '')
      && !page(observer?.callee?.object) && locator(observer?.callee?.object)
      && observer.arguments.every((a:Ast)=>a.type==='Literal');
    if (!locatorRead && (!page(observer?.callee?.object) || !['goto','inspect'].includes(observing ?? ''))) continue;
    if (observing==='inspect' && observer.arguments.length) continue;
    if (observing==='goto' && (observer.arguments.length!==1 || observer.arguments[0].type!=='Literal' || typeof observer.arguments[0].value!=='string')) continue;
    const consumes = (n:Ast):boolean => n===awaits[0]
      || n?.type==='MemberExpression' && !n.computed && !n.optional && consumes(n.object)
      || method(n)==='slice' && n.arguments.every((a:Ast)=>a.type==='Literal') && consumes(n.callee.object);
    // Only an unconditional top-level await/assignment or print of its result.
    if (!(next.type==='ExpressionStatement' && (next.expression.type==='AwaitExpression'
      || next.expression.type==='CallExpression' && next.expression.callee.name==='print' && next.expression.arguments.length===1 && consumes(next.expression.arguments[0])))
      && !(next.type==='VariableDeclaration' && next.declarations.length===1 && next.declarations[0].init===awaits[0])) continue;
    edits.push({start:statement.expression.start,end:statement.expression.end,text:`await __discardBrowserObservation(async()=>(${code.slice(statement.expression.start,statement.expression.end)}))`});
  }
  for (const edit of edits.reverse()) code=code.slice(0,edit.start)+edit.text+code.slice(edit.end);
  return code;
}
