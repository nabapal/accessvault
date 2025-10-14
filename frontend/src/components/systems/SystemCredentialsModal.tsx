import { useEffect, useState, Fragment } from "react";
import { Dialog, Transition } from "@headlessui/react";

import { SystemCredentialSecret } from "@/types";

interface SystemCredentialsModalProps {
  open: boolean;
  onClose: () => void;
  systemName: string;
  credentials: SystemCredentialSecret[];
  isLoading: boolean;
}

export function SystemCredentialsModal({ open, onClose, systemName, credentials, isLoading }: SystemCredentialsModalProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setCopiedId(null);
    }
  }, [open]);

  const handleCopy = async (id: string, secret: string) => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 2000);
    } catch (error) {
      console.error("Failed to copy credential", error);
      alert("Unable to copy credential to clipboard.");
    }
  };

  return (
    <Transition.Root show={open} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="duration-300 ease-out"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="duration-200 ease-in"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/70" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="duration-300 ease-out"
              enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="duration-200 ease-in"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <Dialog.Panel className="w-full max-w-2xl transform overflow-hidden rounded-lg bg-slate-900 p-6 text-left align-middle shadow-xl transition-all">
                <Dialog.Title className="text-lg font-semibold text-slate-100">
                  Credentials for {systemName}
                </Dialog.Title>
                <div className="mt-4 space-y-3">
                  {isLoading ? (
                    <div className="rounded-md border border-slate-800 bg-slate-950/70 p-6 text-center text-sm text-slate-400">
                      Loading credentials...
                    </div>
                  ) : credentials.length === 0 ? (
                    <div className="rounded-md border border-dashed border-slate-700 p-6 text-center text-sm text-slate-400">
                      No credentials available for this system.
                    </div>
                  ) : (
                    credentials.map((credential) => (
                      <div key={credential.id} className="rounded-md border border-slate-800 bg-slate-950/80 p-4">
                        <div className="mb-2 flex items-center justify-between">
                          <div>
                            <div className="text-sm font-semibold text-slate-100">{credential.user_id}</div>
                            <div className="text-xs text-slate-400 uppercase tracking-wide">
                              {credential.access_scope.toUpperCase()} &middot; {credential.login_endpoint}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="rounded-md border border-primary-500 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary-200 transition hover:bg-primary-500/10"
                            onClick={() => handleCopy(credential.id, credential.password)}
                          >
                            {copiedId === credential.id ? "Copied" : "Copy"}
                          </button>
                        </div>
                        <pre className="whitespace-pre-wrap break-words rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-primary-100">
                          {credential.password}
                        </pre>
                      </div>
                    ))
                  )}
                </div>
                <div className="mt-6 flex justify-end">
                  <button
                    type="button"
                    className="rounded-md border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 transition hover:border-slate-500"
                    onClick={onClose}
                  >
                    Close
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
}
