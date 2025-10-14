import { Dialog, Transition } from "@headlessui/react";
import { FitAddon } from "xterm-addon-fit";
import { Terminal } from "xterm";
import "xterm/css/xterm.css";
import { Fragment, useEffect, useRef } from "react";

import { buildTerminalUrl } from "@/services/terminal";

interface TerminalDrawerProps {
  open: boolean;
  systemName: string;
  systemId: string;
  token: string;
  onClose: () => void;
}

export function TerminalDrawer({ open, systemName, systemId, token, onClose }: TerminalDrawerProps) {
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!open || !terminalRef.current) {
      return;
    }

    const term = new Terminal({
      cursorBlink: true,
      theme: {
        background: "#0f172a",
        foreground: "#e2e8f0"
      }
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();

    const socketUrl = buildTerminalUrl(systemId, token);
    const socket = new WebSocket(socketUrl);

    socket.onopen = () => {
      term.write(`\x1b[32mConnected to ${systemName}\x1b[0m\r\n`);
    };

    socket.onmessage = (event) => {
      term.write(event.data);
    };

    socket.onclose = () => {
      term.write("\r\n\x1b[31mConnection closed\x1b[0m");
    };

    socket.onerror = () => {
      term.write("\r\n\x1b[31mWebSocket error\x1b[0m");
    };

    term.onData((data: string) => {
      socket.send(data);
    });

    const handleResize = () => {
      fitAddon.fit();
    };
    window.addEventListener("resize", handleResize);

    socketRef.current = socket;
    termRef.current = term;
    fitRef.current = fitAddon;

    return () => {
      window.removeEventListener("resize", handleResize);
      socket.close();
      term.dispose();
    };
  }, [open, systemId, systemName, token]);

  useEffect(() => {
    if (open && fitRef.current) {
      fitRef.current.fit();
    }
  }, [open]);

  return (
    <Transition.Root show={open} as={Fragment}>
      <Dialog as="div" className="relative z-40" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="duration-200 ease-out"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="duration-150 ease-in"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/60" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-hidden">
          <div className="absolute inset-0 overflow-hidden">
            <div className="fixed inset-y-0 right-0 flex max-w-3xl pl-10">
              <Transition.Child
                as={Fragment}
                enter="transform transition ease-in-out duration-300"
                enterFrom="translate-x-full"
                enterTo="translate-x-0"
                leave="transform transition ease-in-out duration-300"
                leaveFrom="translate-x-0"
                leaveTo="translate-x-full"
              >
                <Dialog.Panel className="pointer-events-auto w-screen max-w-3xl bg-slate-950 shadow-xl">
                  <div className="flex h-full flex-col">
                    <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
                      <Dialog.Title className="text-sm font-semibold text-slate-100">
                        Terminal — {systemName}
                      </Dialog.Title>
                      <button
                        type="button"
                        className="rounded-md border border-slate-700 px-3 py-1 text-xs uppercase text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
                        onClick={onClose}
                      >
                        Close
                      </button>
                    </div>
                    <div className="flex flex-1 bg-slate-950 p-4">
                      <div ref={terminalRef} className="h-full w-full rounded-md border border-slate-800 bg-slate-950" />
                    </div>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
}
