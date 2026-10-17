import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

class ResizeObserverMock implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverMock;

// jsdom has no rendering top layer; interaction tests assert its DOM lifecycle.
HTMLElement.prototype.showPopover = function () {};
HTMLElement.prototype.hidePopover = function () {};

class PointerEventMock extends MouseEvent implements PointerEvent {
  readonly altitudeAngle = 0;
  readonly azimuthAngle = 0;
  readonly height = 1;
  readonly isPrimary: boolean;
  readonly pointerId: number;
  readonly persistentDeviceId = 0;
  readonly pointerType: string;
  readonly pressure = 0;
  readonly tangentialPressure = 0;
  readonly tiltX = 0;
  readonly tiltY = 0;
  readonly twist = 0;
  readonly width = 1;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.isPrimary = init.isPrimary ?? true;
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? "mouse";
  }

  getCoalescedEvents(): PointerEvent[] {
    return [this];
  }

  getPredictedEvents(): PointerEvent[] {
    return [];
  }
}

globalThis.PointerEvent = PointerEventMock;
