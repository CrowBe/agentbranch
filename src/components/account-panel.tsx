"use client";

import { useUser, UserButton, SignInButton } from "@clerk/nextjs";

/**
 * Account panel — the left nav's Account entry. Hosts Clerk's sign-in/user UI
 * when auth is configured (NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY set); otherwise
 * explains that this instance runs without auth (ARCHITECTURE §4 stack).
 *
 * Rendered as an overlay over the preview-primary shell, the same pattern as
 * the model console.
 */
export function AccountPanel({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-scrim/40 p-6 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Account"
      onClick={onClose}
    >
      <div
        className="elevation-overlay flex w-full max-w-sm flex-col overflow-hidden rounded-[var(--radius-xl)] border border-outline-variant bg-surface"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-outline-variant px-6 py-4">
          <h2 className="text-headline-md">Account</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-[var(--radius-sm)] px-2 py-1 text-on-surface-variant hover:bg-surface-high"
          >
            ✕
          </button>
        </header>
        <div className="flex flex-col gap-3 px-6 py-4">
          <AccountBody />
        </div>
      </div>
    </div>
  );
}

const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

function AccountBody() {
  if (!clerkEnabled) {
    return (
      <p className="text-body-md text-on-surface-variant">
        This instance runs without sign-in — everyone shares the same session.
      </p>
    );
  }
  return <ClerkAccountBody />;
}

function ClerkAccountBody() {
  const { isSignedIn } = useUser();
  if (isSignedIn) {
    return (
      <div className="flex items-center gap-3">
        <UserButton />
        <span className="text-body-md">Signed in</span>
      </div>
    );
  }
  return (
    <SignInButton mode="modal">
      <button
        type="button"
        className="rounded-[var(--radius-md)] bg-primary px-4 py-2 text-label text-on-primary"
      >
        Sign in
      </button>
    </SignInButton>
  );
}
