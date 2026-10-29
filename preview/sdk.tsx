import type { ReactNode } from "react";
import { call } from "./fixtures";
const rpc = { call };
export function useRpc() {
  return rpc;
}
export function useComposer() {
  return {
    insert(text: string) {
      document.querySelector("#draft")!.textContent = text;
    },
  };
}
export function experimental_useTabVisible() {
  return true;
}
export function definePluginApp(setup: any) {
  setup({ slots: { experimental_tab() {}, experimental_threadAction() {} } });
  return {};
}
export function Markdown({ content }: { content: string }) {
  return (
    <div className="preview-markdown">
      {content.split("\n\n").map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  );
}
export function UrlLink({ children, href, ...props }: any) {
  return (
    <a href={href} {...props} onClick={(e: any) => e.preventDefault()}>
      {children as ReactNode}
    </a>
  );
}
