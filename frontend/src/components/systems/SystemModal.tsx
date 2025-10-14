import { ChangeEvent, FormEvent, Fragment, useEffect, useMemo, useState } from "react";
import { Dialog, Transition } from "@headlessui/react";

import { AccessType, System } from "@/types";
import type { CredentialFormValue, SystemFormValues } from "@/services/systems";

interface SystemModalProps {
  open: boolean;
  onClose: () => void;
  mode: "create" | "edit";
  initialValues?: System;
  onSubmit: (values: SystemFormValues) => Promise<void>;
}

const createDefaultCredential = (accessScope: AccessType = "gui"): CredentialFormValue => ({
  user_id: "",
  login_endpoint: "",
  access_scope: accessScope,
  password: ""
});

const defaultValues: SystemFormValues = {
  name: "",
  ip_address: "",
  credentials: [createDefaultCredential()]
};

export function SystemModal({ open, onClose, mode, initialValues, onSubmit }: SystemModalProps) {
  const [formValues, setFormValues] = useState<SystemFormValues>({ ...defaultValues });
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      if (mode === "edit" && initialValues) {
        setFormValues({
          name: initialValues.name,
          ip_address: initialValues.ip_address,
          credentials:
            initialValues.credentials.length > 0
              ? initialValues.credentials.map((credential) => ({
                  id: credential.id,
                  user_id: credential.user_id,
                  login_endpoint: credential.login_endpoint,
                  access_scope: credential.access_scope,
                  password: ""
                }))
              : [createDefaultCredential()]
        });
      } else {
        setFormValues({
          ...defaultValues,
          credentials: [createDefaultCredential()]
        });
      }
    }
  }, [open, mode, initialValues]);

  const handleFieldChange = (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = event.target;
    setFormValues((prev) => ({
      ...prev,
      [name]: value
    }));
  };

  const handleCredentialChange = <K extends keyof CredentialFormValue>(index: number, key: K, value: CredentialFormValue[K]) => {
    setFormValues((prev) => {
      const credentials = prev.credentials.map((credential, idx) => {
        if (idx !== index) return credential;
        return { ...credential, [key]: value } as CredentialFormValue;
      });
      return { ...prev, credentials };
    });
  };

  const handleCredentialSecretChange = (index: number, value: string) => {
    setFormValues((prev) => {
      const credentials = prev.credentials.map((credential, idx) =>
        idx === index ? { ...credential, password: value } : credential
      );
      return { ...prev, credentials };
    });
  };

  const handleAddCredential = () => {
    setFormValues((prev) => ({
      ...prev,
      credentials: [...prev.credentials, createDefaultCredential()]
    }));
  };

  const handleRemoveCredential = (index: number) => {
    setFormValues((prev) => {
      if (prev.credentials.length <= 1) {
        return prev;
      }
      return {
        ...prev,
        credentials: prev.credentials.filter((_, idx) => idx !== index)
      };
    });
  };

  const preparedCredentials = useMemo(
    () =>
      formValues.credentials.map((credential) => ({
        ...credential,
        password: credential.password && credential.password.trim().length > 0 ? credential.password : undefined
      })),
    [formValues.credentials]
  );

  const isMissingCredentialData = formValues.credentials.some((credential) => {
    const hasUserId = credential.user_id.trim().length > 0;
    const hasEndpoint = credential.login_endpoint.trim().length > 0;
    const secretValue = (credential.password ?? "").trim();
    const hasPassword = credential.id ? true : secretValue.length > 0;
    return !hasUserId || !hasEndpoint || !hasPassword;
  });

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    try {
      await onSubmit({
        ...formValues,
        credentials: preparedCredentials
      });
      onClose();
    } catch (error) {
      console.error("Failed to save system", error);
    } finally {
      setIsSubmitting(false);
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
                  {mode === "create" ? "Add System" : "Edit System"}
                </Dialog.Title>
                <form onSubmit={handleSubmit} className="mt-4 space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm text-slate-400" htmlFor="name">
                        System Name
                      </label>
                      <input
                        id="name"
                        name="name"
                        value={formValues.name}
                        onChange={handleFieldChange}
                        required
                        className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm text-slate-400" htmlFor="ip_address">
                        Management IP
                      </label>
                      <input
                        id="ip_address"
                        name="ip_address"
                        value={formValues.ip_address}
                        onChange={handleFieldChange}
                        required
                        className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
                      />
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-200">Credentials</h3>
                      <button
                        type="button"
                        className="rounded-md border border-primary-500 px-3 py-1 text-xs font-medium text-primary-300 transition hover:bg-primary-500/20"
                        onClick={handleAddCredential}
                      >
                        + Add Credential
                      </button>
                    </div>
                    <div className="space-y-3">
                      {formValues.credentials.map((credential, index) => (
                        <div key={credential.id ?? index} className="rounded-md border border-slate-800 bg-slate-950/80 p-4">
                          <div className="mb-3 flex items-center justify-between">
                            <span className="text-sm font-medium text-slate-100">Credential {index + 1}</span>
                            <div className="flex items-center gap-3 text-xs text-slate-400">
                              {credential.id && <span>Existing credential &mdash; leave secret blank to keep current value.</span>}
                              {formValues.credentials.length > 1 && (
                                <button
                                  type="button"
                                  className="rounded border border-rose-600 px-2 py-1 text-xs uppercase tracking-wide text-rose-300 transition hover:bg-rose-600/10 hover:text-rose-200"
                                  onClick={() => handleRemoveCredential(index)}
                                >
                                  Remove
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="grid gap-3 md:grid-cols-2">
                            <div>
                              <label className="mb-1 block text-xs text-slate-400" htmlFor={`credential-user-${index}`}>
                                  User ID
                              </label>
                              <input
                                  id={`credential-user-${index}`}
                                  value={credential.user_id}
                                  onChange={(event) => handleCredentialChange(index, "user_id", event.target.value)}
                                required
                                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs text-slate-400" htmlFor={`credential-endpoint-${index}`}>
                                  URL / Login IP
                              </label>
                              <input
                                  id={`credential-endpoint-${index}`}
                                  value={credential.login_endpoint}
                                  onChange={(event) => handleCredentialChange(index, "login_endpoint", event.target.value)}
                                  required
                                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
                                />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs text-slate-400" htmlFor={`credential-scope-${index}`}>
                                Applies To
                              </label>
                              <select
                                id={`credential-scope-${index}`}
                                value={credential.access_scope}
                                onChange={(event) => handleCredentialChange(index, "access_scope", event.target.value as AccessType)}
                                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
                              >
                                <option value="gui">GUI</option>
                                <option value="cli">CLI</option>
                              </select>
                            </div>
                            <div className="md:col-span-2">
                              <label className="mb-1 block text-xs text-slate-400" htmlFor={`credential-secret-${index}`}>
                                  Password
                              </label>
                              <input
                                id={`credential-secret-${index}`}
                                type="password"
                                value={credential.password}
                                onChange={(event) => handleCredentialSecretChange(index, event.target.value)}
                                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex justify-end gap-3">
                    <button
                      type="button"
                      className="rounded-md border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 transition hover:border-slate-500"
                      onClick={onClose}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmitting || isMissingCredentialData}
                      className="rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-500 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSubmitting ? "Saving..." : mode === "create" ? "Create" : "Save"}
                    </button>
                  </div>
                </form>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
}
