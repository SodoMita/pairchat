"use client";

import { useEffect, useState } from "react";
import { useI18n } from "./I18nProvider";

/**
 * Client component that hydrates the cookie-stored display name into the
 * chrome. Since server components can't read non-httpOnly cookies, we
 * just read the public name cookie from `document.cookie`.
 */
export function TopBar() {
  const { t } = useI18n();
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    const match = document.cookie
      .split("; ")
      .find((c) => c.startsWith("roulette_name="));
    if (match) {
      setName(decodeURIComponent(match.slice("roulette_name=".length)));
    }
  }, []);

  return (
    <div className="text-sm text-slate-300">
      {name ? (
        <span>
          {t("youAre")}{" "}
          <span className="rounded-full bg-slate-800 px-3 py-1 font-medium text-slate-100">
            {name}
          </span>
        </span>
      ) : (
        <span>{t("anonymous")}</span>
      )}
    </div>
  );
}