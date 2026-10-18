"use client";

import {
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
  type ComponentProps,
} from "react";
import { XIcon } from "lucide-react";
import { Button } from "./components/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "./components/drawer";
import styles from "./report-drawer.module.css";

const MOBILE_QUERY = "(max-width: 767px)";
function subscribe(onChange: () => void) {
  const media = window.matchMedia?.(MOBILE_QUERY);
  media?.addEventListener("change", onChange);
  return () => media?.removeEventListener("change", onChange);
}
const mobileSnapshot = () => window.matchMedia?.(MOBILE_QUERY).matches ?? false;
const serverSnapshot = () => false;

/** One accessible report surface across disease, genome and CRISPR reports. */
export function ReportDrawer({
  title,
  description,
  trigger,
  footer,
  hideHeading = false,
  children,
  ...props
}: {
  title: string;
  description: string;
  trigger?: ReactElement;
  footer?: ReactNode;
  /** Retain the accessible name while a full-surface state owns the visible heading. */
  hideHeading?: boolean;
  children: ReactNode;
} & Pick<ComponentProps<typeof Drawer>, "open" | "onOpenChange">) {
  const mobile = useSyncExternalStore(
    subscribe,
    mobileSnapshot,
    serverSnapshot,
  );
  return (
    <Drawer
      swipeDirection={mobile ? "down" : "right"}
      showSwipeHandle={mobile}
      {...props}
    >
      {trigger && <DrawerTrigger render={trigger} />}
      <DrawerContent className={styles.drawer}>
        <DrawerHeader
          className={styles.header}
          data-heading-hidden={hideHeading || undefined}
        >
          <DrawerTitle className={hideHeading ? "sr-only" : undefined}>
            {title}
          </DrawerTitle>
          <DrawerDescription className={hideHeading ? "sr-only" : undefined}>
            {description}
          </DrawerDescription>
          <DrawerClose
            render={
              <Button
                variant="ghost"
                size="icon"
                className={styles.close}
                aria-label="Close"
              />
            }
          >
            <XIcon aria-hidden="true" />
          </DrawerClose>
        </DrawerHeader>
        <div className={styles.body} data-report-scroll="">
          {children}
        </div>
        {footer && (
          <DrawerFooter className={styles.footer}>{footer}</DrawerFooter>
        )}
      </DrawerContent>
    </Drawer>
  );
}
