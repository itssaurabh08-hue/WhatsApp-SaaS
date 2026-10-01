"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface FacebookSdk {
  init(opts: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void;
  login(cb: (response: { authResponse?: { code?: string } | null }) => void, opts: Record<string, unknown>): void;
}

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

type SessionInfo = { wabaId: string; phoneNumberId: string; businessId: string | null };
type Result = { ok: boolean; message: string };

const SDK_URL = "https://connect.facebook.net/en_US/sdk.js";

/** Only accept postMessage events from facebook.com itself (Meta's sample uses a looser suffix check). */
function isFacebookOrigin(origin: string) {
  try {
    const host = new URL(origin).hostname;
    return host === "facebook.com" || host.endsWith(".facebook.com");
  } catch {
    return false;
  }
}

/**
 * Launches Meta's Embedded Signup (WA/embedded-signup/implementation). The flow
 * returns a code via the login callback and the WABA / phone number IDs via a
 * postMessage event; both are sent to the server, which must exchange the code
 * within 30 seconds.
 */
export function ConnectWhatsAppButton({
  appId,
  configId,
  apiVersion,
  onComplete,
  label = "Connect with Facebook",
}: {
  appId: string;
  configId: string;
  apiVersion: string;
  onComplete: (input: { code: string } & SessionInfo) => Promise<Result>;
  label?: string;
}) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionInfo = useRef<SessionInfo | null>(null);

  useEffect(() => {
    if (window.FB) {
      // SDK already loaded by an earlier visit in this session.
      queueMicrotask(() => setReady(true));
      return;
    }
    window.fbAsyncInit = () => {
      window.FB?.init({ appId, autoLogAppEvents: true, xfbml: false, version: apiVersion });
      setReady(true);
    };
    if (!document.querySelector(`script[src="${SDK_URL}"]`)) {
      const script = document.createElement("script");
      script.src = SDK_URL;
      script.async = true;
      script.defer = true;
      script.crossOrigin = "anonymous";
      script.onerror = () =>
        setError("Could not load Facebook. Check your connection or browser extensions and reload the page.");
      document.body.appendChild(script);
    }
  }, [appId, apiVersion]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!isFacebookOrigin(event.origin)) return;
      let data: { type?: string; event?: string; data?: Record<string, unknown> };
      try {
        data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      if (data?.type !== "WA_EMBEDDED_SIGNUP") return;
      if (data.event?.startsWith("FINISH") && data.data) {
        const d = data.data;
        if (typeof d.waba_id === "string" && typeof d.phone_number_id === "string") {
          sessionInfo.current = {
            wabaId: d.waba_id,
            phoneNumberId: d.phone_number_id,
            businessId: typeof d.business_id === "string" ? d.business_id : null,
          };
        } else if (data.event === "FINISH_ONLY_WABA") {
          setError("No phone number was added during setup. Connect again and add a business phone number.");
        }
      } else if (data.event === "CANCEL") {
        const step = typeof data.data?.current_step === "string" ? data.data.current_step : null;
        const reported = typeof data.data?.error_message === "string" ? data.data.error_message : null;
        setBusy(false);
        setError(
          reported ??
            (step
              ? `Setup was closed before finishing (at step ${step.replace(/_/g, " ").toLowerCase()}).`
              : "Setup was closed before finishing."),
        );
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const handleCode = useCallback(
    async (code: string) => {
      // The session-info message usually arrives before the callback; wait briefly if not.
      for (let i = 0; i < 20 && !sessionInfo.current; i++) await new Promise((r) => setTimeout(r, 150));
      const info = sessionInfo.current;
      if (!info) {
        setBusy(false);
        setError("Meta did not return the account details. Please try connecting again.");
        return;
      }
      const result = await onComplete({ code, ...info });
      setBusy(false);
      if (result.ok) {
        toast.success(result.message);
        router.refresh();
      } else {
        setError(result.message);
        router.refresh();
      }
    },
    [onComplete, router],
  );

  const launch = () => {
    if (!window.FB) return;
    setError(null);
    setBusy(true);
    sessionInfo.current = null;
    window.FB.login(
      (response) => {
        const code = response.authResponse?.code;
        if (code) void handleCode(code);
        else setBusy(false);
      },
      { config_id: configId, response_type: "code", override_default_response_type: true, extras: { setup: {} } },
    );
  };

  return (
    <div className="grid gap-3">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div>
        <Button onClick={launch} disabled={!ready || busy} className="bg-[#1877f2] text-white hover:bg-[#1877f2]/90">
          {busy ? "Connecting…" : label}
        </Button>
      </div>
    </div>
  );
}
