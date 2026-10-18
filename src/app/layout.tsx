import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { I18nProvider } from "./_components/I18nProvider";
import { NotificationCount } from "./_components/NotificationCount";
import { NotificationSound } from "./_components/NotificationSound";

export const metadata: Metadata = {
  title: "Chatterbox — Chat roulette & private rooms",
  description:
    "Text-first chat roulette. Pair with a random stranger, or spin up a private room and share a link.",
};

// This layout reads no cookies or headers, so every page below it can be
// statically rendered and served from cache.
//
// Pre-paint guard: static HTML is English. If the visitor's language is not
// English, hide the body for an instant so it never flashes in the wrong
// language; I18nProvider reveals it once the right locale is applied, and a
// timeout is the failsafe if scripts fail to run.
const noFlash = `(function(){try{var l=localStorage.getItem("chatterbox.locale")||navigator.language||"en";if(!/^en(-|$)/i.test(l)){var d=document.documentElement;d.setAttribute("data-i18n-pending","");setTimeout(function(){d.removeAttribute("data-i18n-pending")},1500)}}catch(e){}})();`;
const noFlashCss = "html[data-i18n-pending] body{visibility:hidden}";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlash }} />
        <style dangerouslySetInnerHTML={{ __html: noFlashCss }} />
      </head>
      <body className="bg-slate-950 text-slate-100 antialiased">
        <I18nProvider>
          <NotificationCount />
          <NotificationSound />
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
