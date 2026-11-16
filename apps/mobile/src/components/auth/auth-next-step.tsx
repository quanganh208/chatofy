/**
 * The one accent-filled control on an auth screen that has finished its work —
 * a link was sent, a password changed, a link turned out to be broken — and so
 * has a single way on and no form to submit.
 *
 * Its own component so each screen file draws no default-variant `Button`
 * directly: a screen with two outcome states would otherwise hold two in one
 * file, which the style gate refuses even though only one is ever on screen.
 */
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';

export function AuthNextStep({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Button onPress={onPress}>
      <Text>{label}</Text>
    </Button>
  );
}
