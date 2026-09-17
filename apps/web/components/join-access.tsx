"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { PublicFeatures } from "@openround/contracts";
import { apiFetch } from "../lib/api";
import {
  buildJoinUrl,
  isLoopbackJoinBase,
  normalizeJoinBase,
  selectJoinBase,
} from "../lib/join-url";

const storageKey = "openround:join-base";

export function JoinAccess({
  code,
  editable = false,
  size = 190,
}: {
  code: string;
  editable?: boolean;
  size?: number;
}) {
  const [base, setBase] = useState("");
  const [automaticBase, setAutomaticBase] = useState("");
  const [candidate, setCandidate] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [addressError, setAddressError] = useState("");
  const qrFrame = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    const current = window.location.origin;
    const saved = window.localStorage.getItem(storageKey);
    const initial = selectJoinBase({ current, saved });
    setBase(initial);
    setAutomaticBase(selectJoinBase({ current }));
    setCandidate(initial);

    apiFetch<PublicFeatures>("/v1/features")
      .then((features) => {
        if (!active) return;
        const automatic = selectJoinBase({ configured: features.publicWebUrl, current });
        setAutomaticBase(automatic);
        const selected = selectJoinBase({
          configured: features.publicWebUrl,
          current,
          saved,
        });
        setBase(selected);
        setCandidate(selected);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);

  const joinUrl = buildJoinUrl(base, code);
  const deviceLocal = !joinUrl || isLoopbackJoinBase(base);

  async function copyJoinLink() {
    if (!joinUrl) return;
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopyStatus("Join link copied.");
    } catch {
      setCopyStatus("Copy was blocked. Select and copy the link above.");
    }
  }

  function serializedQr() {
    const source = qrFrame.current?.querySelector("svg");
    if (!source) return null;
    const svg = source.cloneNode(true) as SVGSVGElement;
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    return new XMLSerializer().serializeToString(svg);
  }

  function triggerDownload(url: string, extension: "svg" | "png") {
    const link = document.createElement("a");
    link.href = url;
    link.download = `openround-${code}-qr.${extension}`;
    document.body.append(link);
    link.click();
    link.remove();
  }

  function downloadSvg() {
    const svg = serializedQr();
    if (!svg) return;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    triggerDownload(url, "svg");
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setCopyStatus("QR code downloaded as SVG.");
  }

  function downloadPng() {
    const svg = serializedQr();
    if (!svg) return;
    const sourceUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1024;
      canvas.height = 1024;
      const context = canvas.getContext("2d");
      if (!context) {
        URL.revokeObjectURL(sourceUrl);
        setCopyStatus("PNG conversion is not supported in this browser. Download SVG instead.");
        return;
      }
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(sourceUrl);
        if (!blob) {
          setCopyStatus("PNG conversion failed. Download SVG instead.");
          return;
        }
        const pngUrl = URL.createObjectURL(blob);
        triggerDownload(pngUrl, "png");
        window.setTimeout(() => URL.revokeObjectURL(pngUrl), 0);
        setCopyStatus("QR code downloaded as PNG.");
      }, "image/png");
    };
    image.onerror = () => {
      URL.revokeObjectURL(sourceUrl);
      setCopyStatus("PNG conversion failed. Download SVG instead.");
    };
    image.src = sourceUrl;
  }

  function updateAddress(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizeJoinBase(candidate);
    if (!normalized) {
      setAddressError("Enter an HTTP or HTTPS address, such as http://192.168.1.20:8080.");
      return;
    }
    window.localStorage.setItem(storageKey, normalized);
    setBase(normalized);
    setCandidate(normalized);
    setAddressError("");
    setCopyStatus("QR code updated.");
  }

  function resetAddress() {
    window.localStorage.removeItem(storageKey);
    setBase(automaticBase);
    setCandidate(automaticBase);
    setAddressError("");
    setCopyStatus("Using the configured join address.");
  }

  return (
    <section className="join-access" aria-label="Join this round by QR code or direct link">
      <p className="eyebrow">Scan to join</p>
      {joinUrl ? (
        <>
          <div className="join-qr-frame" ref={qrFrame}>
            <QRCodeSVG
              aria-label={`QR code for round ${code.split("").join(" ")}`}
              bgColor="#ffffff"
              fgColor="#0b2239"
              size={size}
              value={joinUrl}
            />
          </div>
          <a
            aria-label="Open the prefilled participant join link"
            className="join-url"
            data-testid="join-url"
            href={joinUrl}
            rel="noreferrer"
            target="_blank"
          >
            {joinUrl}
          </a>
          {editable ? (
            <div className="button-row join-asset-actions">
              <button
                className="button-quiet small-button"
                onClick={() => void copyJoinLink()}
                type="button"
              >
                Copy join link
              </button>
              <button className="button-quiet small-button" onClick={downloadSvg} type="button">
                Download QR SVG
              </button>
              <button className="button-quiet small-button" onClick={downloadPng} type="button">
                Download QR PNG
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <p className="muted">Preparing the join link…</p>
      )}
      {deviceLocal ? (
        <p className="notice join-address-notice">
          A localhost QR works only on this computer. Use this computer's Wi-Fi/LAN address or a
          public HTTPS address before participants scan it.
        </p>
      ) : (
        <p className="muted join-address-note">Participants can scan this QR or open the link.</p>
      )}
      {editable ? (
        <details className="join-address-settings" open={deviceLocal}>
          <summary>Change join address</summary>
          <form className="join-address-form" onSubmit={updateAddress}>
            <label className="field" htmlFor="join-base-address">
              <span>Network or public product address</span>
              <input
                className="input"
                id="join-base-address"
                inputMode="url"
                onChange={(event) => setCandidate(event.target.value)}
                placeholder="http://192.168.1.20:8080"
                type="url"
                value={candidate}
              />
            </label>
            {addressError ? (
              <p className="error" role="alert">
                {addressError}
              </p>
            ) : null}
            <div className="button-row">
              <button className="button small-button" type="submit">
                Update QR
              </button>
              <button className="button-quiet small-button" onClick={resetAddress} type="button">
                Reset address
              </button>
            </div>
          </form>
        </details>
      ) : null}
      {copyStatus ? (
        <p className="muted join-copy-status" role="status">
          {copyStatus}
        </p>
      ) : null}
    </section>
  );
}
