import { SignIn } from "@clerk/nextjs";
import { redirect } from "next/navigation";

export const metadata = {
  title: "Sign In",
};

export default function SignInPage() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    redirect("/");
  }

  return (
    <main className="app-main app-frame flex min-h-[70vh] w-full items-center justify-center p-5 sm:p-8">
      <SignIn
        path="/sign-in"
        routing="path"
        signUpUrl="/sign-up"
        fallbackRedirectUrl="/"
        forceRedirectUrl="/"
      />
    </main>
  );
}
