import { Pressable, View } from 'react-native';

import { TOUCH_TARGET, radius, useTheme } from '@/theme';

export interface SwitchControlProps {
  value: boolean;
  onChange: (value: boolean) => void;
  /** What the switch is for, said out loud. */
  label: string;
  disabled?: boolean;
}

const TRACK_WIDTH = 50;
const TRACK_HEIGHT = 30;
const KNOB = 24;

/**
 * A switch you can actually hit, and that is only one thing.
 *
 * ---------------------------------------------------------------------------
 * Why this is not React Native's Switch
 * ---------------------------------------------------------------------------
 *
 * Two findings from the same audit, one after the other.
 *
 * First, React Native Web renders `Switch` at its platform size, which
 * measures 20 pixels tall -- less than half of what a thumb needs, and the
 * smallest interactive thing anywhere in this product. It was on every screen
 * that has a setting.
 *
 * Putting it inside a pressable box of a proper size fixed the target and
 * broke something else: the platform switch is an `<input type="checkbox">`,
 * so the box became a control containing a control. `aria-hidden` on the
 * wrapper does not make an input unfocusable, and axe was right to call it
 * *nested interactive* -- a keyboard would still stop on the inner one.
 *
 * So the track and the knob are drawn here. One pressable, one role, one
 * state, forty-eight pixels of target, and nothing focusable inside it.
 */
export function SwitchControl({ value, onChange, label, disabled = false }: SwitchControlProps) {
  const { palette } = useTheme();

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled }}
      aria-checked={value}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={{
        minWidth: TOUCH_TARGET,
        minHeight: TOUCH_TARGET,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.md,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <View
        style={{
          width: TRACK_WIDTH,
          height: TRACK_HEIGHT,
          borderRadius: radius.pill,
          borderWidth: 1,
          borderColor: value ? palette.accent : palette.border,
          backgroundColor: value ? palette.accent : palette.surfaceMuted,
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            width: KNOB,
            height: KNOB,
            borderRadius: radius.pill,
            backgroundColor: palette.surface,
            // Sits at whichever end the state says, with the same gap either
            // side, so the travel reads as movement rather than as a redraw.
            marginLeft: value ? TRACK_WIDTH - KNOB - 4 : 2,
          }}
        />
      </View>
    </Pressable>
  );
}
