import * as React from "react";

import type { WidgetId, WidgetSize } from "./index";

type GridItemElementProps = Readonly<{
  id: WidgetId;
  label: string;
  size: WidgetSize;
}>;

export function flattenGridChildren(
  children: React.ReactNode,
): React.ReactElement[] {
  const flattened: React.ReactElement[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type === React.Fragment) {
      const fragment = child as React.ReactElement<{
        children?: React.ReactNode;
      }>;
      flattened.push(...flattenGridChildren(fragment.props.children));
      return;
    }
    flattened.push(child);
  });
  return flattened;
}

export function isGridItemElement(
  child: React.ReactElement,
): child is React.ReactElement<GridItemElementProps> {
  const props: unknown = child.props;
  if (!props || typeof props !== "object") return false;
  const candidate = props as {
    id?: unknown;
    label?: unknown;
    size?: unknown;
  };
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.label === "string" &&
    (candidate.size === "normal" || candidate.size === "small")
  );
}
