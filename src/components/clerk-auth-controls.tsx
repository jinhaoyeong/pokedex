"use client";

import { SignInButton, SignUpButton, UserButton, useUser } from "@clerk/nextjs";

const userButtonAppearance = {
  elements: {
    avatarImage: "clerk-pokedex-avatar-image",
    avatarBox: "header-user-avatar",
    userButtonPopoverCard: "header-user-popover",
    userButtonPopoverActionButton: "header-user-popover-action",
    userButtonPopoverActionButtonText: "header-user-popover-action-text",
    userButtonPopoverFooter: "header-user-popover-footer",
  },
  variables: { colorBackground: "#071124", colorPrimary: "#E3350D", borderRadius: "0.75rem" },
};

function HeaderAuthControls({ mobile }: { mobile: boolean }) {
  const { isLoaded, isSignedIn } = useUser();
  const className = mobile
    ? "header-auth-controls mobile-header-auth-controls flex shrink-0 items-center justify-end"
    : "header-auth-controls flex shrink-0 items-center justify-end gap-2";

  return (
    <div className={className}>
      {isLoaded && !isSignedIn ? (
        <>
          <SignInButton mode="modal"><button type="button" className="header-auth-button header-auth-button-secondary">Sign In</button></SignInButton>
          {!mobile ? <SignUpButton mode="modal"><button type="button" className="header-auth-button header-auth-button-primary">Sign Up</button></SignUpButton> : null}
        </>
      ) : null}
      {isLoaded && isSignedIn ? <UserButton appearance={userButtonAppearance} /> : null}
    </div>
  );
}

/** Rendered beneath the single app-level ClerkProvider when Clerk is configured. */
export function ClerkHeaderAuthControls({ mobile = false }: { mobile?: boolean }) {
  return <HeaderAuthControls mobile={mobile} />;
}
