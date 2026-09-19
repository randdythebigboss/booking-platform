import { Switch, View } from 'react-native';

import { spacing, useTheme } from '@/theme';
import { Text } from './text';

export interface ToggleRowProps {
  label: string;
  description?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}

export function ToggleRow({ label, description, value, onChange, disabled }: ToggleRowProps) {
  const { palette } = useTheme();

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
      <View style={{ flex: 1, gap: spacing.xs }}>
        <Text variant="label">{label}</Text>
        {description && (
          <Text variant="caption" tone="muted">
            {description}
          </Text>
        )}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        accessibilityLabel={label}
        trackColor={{ true: palette.accent, false: palette.border }}
      />
    </View>
  );
}
