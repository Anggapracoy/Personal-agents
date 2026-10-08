"use client";
import { hasPendingMessageSend } from "./message-send-motion";
import { Component, useLayoutEffect, useRef, type ReactNode } from "react";

type ContentProps = { active: boolean; children: ReactNode; preserveBubble?:boolean };
type ContentSnapshot = { height: number; ghost: HTMLElement; background?:string; radius?:string } | null;

/** Keep the previous visual in place while an inline control becomes its receipt. */
export class InlinePanelContent extends Component<ContentProps> {
  private frame: HTMLDivElement | null = null;
  private content: HTMLDivElement | null = null;
  private animations: Animation[] = [];
  private ghost: HTMLElement | null = null;

  getSnapshotBeforeUpdate(previous: ContentProps): ContentSnapshot {
    if (previous.active === this.props.active || !this.frame || !this.content || matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
    this.clearMotion();
    const ghost = this.content.cloneNode(true) as HTMLElement;
    ghost.querySelectorAll("[id]").forEach(node => node.removeAttribute("id"));
    ghost.setAttribute("aria-hidden", "true");
    ghost.inert = true;
    const bubble=this.props.preserveBubble ? this.content.querySelector<HTMLElement>(".wd-agent, .wd-inline-card") : null;
    const style=bubble ? getComputedStyle(bubble) : null;
    return { height: this.frame.getBoundingClientRect().height, ghost,background:style?.backgroundColor,radius:style?.borderRadius };
  }

  componentDidUpdate(_previous: ContentProps, _state: unknown, snapshot: ContentSnapshot) {
    if (!snapshot || !this.frame || !this.content) return;
    const frame = this.frame;
    const content = this.content;
    const nextHeight = content.getBoundingClientRect().height;
    const { height, ghost } = snapshot;
    this.ghost = ghost;
    frame.style.height = `${height}px`;
    frame.style.overflow = "hidden";
    frame.style.position = "relative";
    if(snapshot.background){frame.dataset.bubbleTransition="true";frame.style.background=snapshot.background;frame.style.borderRadius=snapshot.radius??"20px";}
    ghost.classList.add("wd-inline-panel-ghost");
    frame.appendChild(ghost);
    const easing = "cubic-bezier(.2,.75,.2,1)";
    const options = { duration: 210, easing, fill:"forwards" as const };
    const resize = frame.animate([{ height: `${height}px` }, { height: `${nextHeight}px` }], options);
    const leave = ghost.animate([{ opacity: 1, transform: "translateY(0)" }, { opacity: 0, transform: "translateY(-3px)" }], { duration: 135, easing: "ease-out", fill:"forwards" });
    const enter = content.animate([{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 190, easing, fill:"forwards" });
    this.animations = [resize, leave, enter];
    resize.onfinish = () => this.clearMotion();
  }

  componentWillUnmount() { this.clearMotion(); }

  private clearMotion() {
    for (const animation of this.animations) animation.cancel();
    this.animations = [];
    this.ghost?.remove();
    this.ghost = null;
    if (this.frame) { this.frame.style.height = ""; this.frame.style.overflow = ""; this.frame.style.position = ""; this.frame.style.background="";this.frame.style.borderRadius="";delete this.frame.dataset.bubbleTransition; }
  }

  render() {
    return <div ref={node => { this.frame = node; }} className="wd-inline-panel-frame"><div ref={node => { this.content = node; }} className="wd-inline-panel-content">{this.props.children}</div></div>;
  }
}

/** Reserve the old height until the outgoing bubble has landed. */
export function TimelinePanel({ id, active, children, className }: { id: string; active: boolean; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const height = useRef(0);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const root = node.closest<HTMLElement>(".wd");
    const page = node.closest<HTMLElement>(".wd-task");
    const sending = !matchMedia("(prefers-reduced-motion: reduce)").matches && (root?.dataset.sendingMessage || (page && hasPendingMessageSend(page)));
    if (sending && height.current) { node.style.height = `${height.current}px`; node.style.overflow = "hidden"; }
    const observer = new MutationObserver(() => {
      if (!root?.dataset.sendingMessage) {
        const before = node.getBoundingClientRect().height;
        node.style.height = "";
        node.style.overflow = "";
        const after = node.getBoundingClientRect().height;
        height.current = after;
        if (Math.abs(before - after) > .5 && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
          node.animate([{ height: `${before}px` }, { height: `${after}px` }], { duration: 180, easing: "ease-out" });
        }
      }
    });
    if (root) observer.observe(root, { attributes: true, attributeFilter: ["data-sending-message"] });
    if (!sending) height.current = node.getBoundingClientRect().height;
    return () => observer.disconnect();
  });
  return <div ref={ref} className={`wd-timeline-panel${className ? ` ${className}` : ""}`} data-inline-id={id} data-inline-active={active}><InlinePanelContent active={active}>{children}</InlinePanelContent></div>;
}
