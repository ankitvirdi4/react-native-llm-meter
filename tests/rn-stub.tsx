// Minimal react-native stub for unit tests in node + happy-dom.
// Renders RN primitives as DOM elements so happy-dom can host them.
// Not a runtime dep; only resolved via vitest alias.

import {
  createElement,
  forwardRef,
  type ComponentType,
  type CSSProperties,
  type ForwardedRef,
  type ReactNode,
} from "react";

type Style = CSSProperties | Style[] | null | undefined | false;

function flattenStyle(style: Style): CSSProperties | undefined {
  if (!style) return undefined;
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.flat().filter(Boolean));
  }
  return style;
}

interface BaseProps {
  children?: ReactNode;
  style?: Style;
  testID?: string;
  [key: string]: unknown;
}

const passthrough = (tag: string): ComponentType<BaseProps> =>
  forwardRef(
    (
      { children, style, testID, ...rest }: BaseProps,
      ref: ForwardedRef<unknown>,
    ) =>
      createElement(
        tag,
        {
          ref,
          "data-testid": testID,
          style: flattenStyle(style),
          ...rest,
        },
        children,
      ),
  );

export const View = passthrough("div");
export const Text = passthrough("span");
export const ScrollView = passthrough("div");

interface PressableProps extends BaseProps {
  onPress?: () => void;
}

export const Pressable: ComponentType<PressableProps> = ({
  children,
  style,
  onPress,
  testID,
  ...rest
}) =>
  createElement(
    "button",
    {
      "data-testid": testID,
      onClick: onPress,
      style: flattenStyle(style),
      ...rest,
    },
    children,
  );

export const StyleSheet = {
  create<T extends Record<string, CSSProperties>>(styles: T): T {
    return styles;
  },
};

class ValueXY {
  constructor(_initial?: { x: number; y: number }) {}
  getLayout() {
    return { left: 0, top: 0 };
  }
  extractOffset() {}
  flattenOffset() {}
  // Allow Animated.event handler to set pan.x/y like values.
  x = 0;
  y = 0;
}

export const Animated = {
  ValueXY,
  View,
  event: () => () => {},
};

export const PanResponder = {
  create: () => ({ panHandlers: {} }),
};
