/**
 * The two kinds of message an auth screen shows about its own outcome.
 *
 * A refusal is `Alert variant="destructive"` and keeps the Alert's `alert` role,
 * so a screen reader interrupts with it. A completed step ("check your email")
 * is the default Alert announced politely as `status`: it reports success, it
 * does not demand attention. Each carries an icon as well as its colour, so the
 * two never differ by hue alone.
 */
import { CircleAlert, CircleCheck } from 'lucide-react-native';
import { Alert, AlertDescription } from '@/components/ui/alert';

export function AuthError({ message }: { message: string }) {
  return (
    <Alert variant="destructive" icon={CircleAlert}>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

export function AuthStatus({ message }: { message: string }) {
  return (
    <Alert role="status" aria-live="polite" icon={CircleCheck}>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
