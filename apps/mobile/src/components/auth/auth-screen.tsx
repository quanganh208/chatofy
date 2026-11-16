/**
 * The frame every auth screen sits in: the app's version of web's `PlainFrame`.
 *
 * The brand across the top and one measured column below it, with no navigation
 * and no session control — nobody is signed in yet, so there is nothing to sign
 * out of. Each screen carries its own return links in its body, under the form
 * they are an alternative to.
 *
 * Safe area, keyboard avoidance and scrolling behave as the older `Screen` does:
 * iOS pads for the keyboard, Android relies on the window resizing, and taps
 * that land on a button while the keyboard is up still press it.
 *
 * No card: the form sits on the page ground, because a screen at rest draws no
 * elevated surface (the UI review rules in .claude/rules/development-rules.md).
 */
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BrandMark } from '@/components/brand/brand-mark';
import { BrandWordmark } from '@/components/brand/brand-wordmark';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';

interface AuthScreenProps {
  title: string;
  /** One line under the title saying what this screen is for. */
  description?: string;
  children: ReactNode;
}

export function AuthScreen({ title, description, children }: AuthScreenProps) {
  return (
    <SafeAreaView className="flex-1 bg-background">
      <View
        className="flex-row items-center gap-2 border-b border-border px-6 py-4"
        accessible
        role="img"
        aria-label="Chatofy"
      >
        <BrandMark size={24} />
        <BrandWordmark size={17} />
      </View>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerClassName="grow px-6 py-8" keyboardShouldPersistTaps="handled">
          <View className="w-full max-w-[480px] gap-8 self-center">
            <View className="gap-2">
              <Text variant="h1">{title}</Text>
              {description ? (
                <Text className="leading-6 text-muted-foreground">{description}</Text>
              ) : null}
            </View>
            {children}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** The fields, the message about them and the submit control, spaced as one group. */
export function AuthForm({ children }: { children: ReactNode }) {
  return <View className="gap-4">{children}</View>;
}

interface AuthSubmitProps {
  label: string;
  /** What the button says while the request is out ("Signing in…"). */
  busyLabel: string;
  busy: boolean;
  onPress: () => void;
}

/**
 * The screen's one accent-filled control, the form's submit.
 *
 * While busy it is announced as busy and disabled through `aria-*` rather than
 * `disabled`: the Button dims a disabled control to half strength, which would
 * put the busy label under its contrast floor at the moment someone is watching
 * it. Pressability ignores `aria-disabled`, so a press still arrives — every
 * caller's submit returns early while its request is out, which is what keeps a
 * second request from being sent.
 */
export function AuthSubmit({ label, busyLabel, busy, onPress }: AuthSubmitProps) {
  return (
    <Button onPress={onPress} aria-disabled={busy} aria-busy={busy}>
      <Text>{busy ? busyLabel : label}</Text>
    </Button>
  );
}

/** The return links under a form, centred, each a full 48px target. */
export function AuthFooter({ children }: { children: ReactNode }) {
  return <View className="items-center gap-1">{children}</View>;
}
