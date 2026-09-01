import { SignUp } from "@clerk/nextjs";
import { redirect } from "next/navigation";

export const metadata = {
  title: "Sign Up",
};

export default function SignUpPage() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    redirect("/");
  }

  return (
    <main className="app-main app-frame flex min-h-[70vh] w-full items-center justify-center p-5 sm:p-8">
      <SignUp
        path="/sign-up"
        routing="path"
        signInUrl="/sign-in"
        fallbackRedirectUrl="/"
        forceRedirectUrl="/"
      />
    </main>
  );
}
