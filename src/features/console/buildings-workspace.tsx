/* eslint-disable @next/next/no-img-element -- Pre-sized WebP assets and authenticated image responses bypass the optimizer. */
"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ImagePlus, X } from "lucide-react";
import { uploadImage } from "../feedback/image-upload";
import "./buildings-workspace.css";
import { CampusSegments } from "@/features/campus-map/components/campus-segments";

type Building = {
  id: string;
  name: string;
  description: string;
  photos: string[];
  campus: "university" | "baiyun";
};
type Client = <T>(path: string, method?: string, body?: unknown) => Promise<T>;

export function BuildingsWorkspace({ request }: { request: Client }) {
  const [items, setItems] = useState<Building[]>([]);
  const [selected, setSelected] = useState("");
  const [search, setSearch] = useState("");
  const [campus, setCampus] = useState<"university" | "baiyun">("university");
  const [error, setError] = useState("");
  useEffect(() => {
    request<{ items: Building[] }>("v2/buildings")
      .then((result) => {
        setItems(result.items);
        setSelected((previous) => previous || result.items[0]?.id || "");
      })
      .catch((error: Error) => setError(error.message));
  }, [request]);
  const current = items.find((item) => item.id === selected);
  return (
    <>
      <div className="console-heading">
        <h1>建筑管理</h1>
        <CampusSegments
          label="建筑校区"
          value={campus}
          onChange={(value) => {
            setCampus(value);
            setSearch("");
            setSelected(
              items.find((item) => (item.campus || "university") === value)
                ?.id || "",
            );
          }}
        />
      </div>
      {error && (
        <p className="console-error" role="alert">
          {error}
        </p>
      )}
      <section className="console-card building-manager">
        <label>
          搜索建筑
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          建筑
          <select
            aria-label="建筑"
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            {items
              .filter(
                (item) =>
                  (item.campus || "university") === campus &&
                  (item.id === selected || item.name.includes(search)),
              )
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </label>
        {current && (
          <BuildingEditor
            key={current.id}
            building={current}
            request={request}
            onSave={(value) =>
              setItems((previous) =>
                previous.map((item) => (item.id === value.id ? value : item)),
              )
            }
          />
        )}
      </section>
    </>
  );
}

function BuildingEditor({
  building,
  request,
  onSave,
}: {
  building: Building;
  request: Client;
  onSave(value: Building): void;
}) {
  const [description, setDescription] = useState(building.description);
  const [photos, setPhotos] = useState(building.photos);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  async function upload(files: File[]) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      for (const file of files) {
        const form = new FormData();
        form.set("image", await uploadImage(file));
        const result = await request<{ url: string }>(
          "v2/buildings/upload",
          "POST",
          form,
        );
        setPhotos((previous) => [...previous, result.url]);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "上传失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  function move(index: number, offset: number) {
    setPhotos((previous) => {
      const next = [...previous];
      [next[index], next[index + offset]] = [next[index + offset], next[index]];
      return next;
    });
    setMessage("");
  }
  async function save() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await request("v2/buildings/" + building.id, "POST", {
        description,
        photos,
      });
      onSave({ ...building, description, photos });
      setMessage("已保存");
    } catch (error) {
      setError(error instanceof Error ? error.message : "保存失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="building-editor">
      <label>
        简介
        <textarea
          aria-label="简介"
          rows={5}
          value={description}
          onChange={(event) => {
            setDescription(event.target.value);
            setMessage("");
          }}
        />
      </label>
      <div className="building-editor-heading">
        <h2>图片</h2>
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current!.click()}
        >
          <ImagePlus size={19} />
          上传图片
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        hidden
        onChange={(event) => {
          void upload(Array.from(event.target.files || []));
          event.target.value = "";
        }}
      />
      <div className="building-editor-photos">
        {photos.map((url, index) => (
          <figure key={url}>
            <img
              src={url}
              alt={building.name + "照片" + (index + 1)}
              loading="lazy"
            />
            <figcaption>
              <span>{index + 1}</span>
              <button
                type="button"
                aria-label={"上移图片" + (index + 1)}
                disabled={busy || index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUp size={18} />
              </button>
              <button
                type="button"
                aria-label={"下移图片" + (index + 1)}
                disabled={busy || index === photos.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown size={18} />
              </button>
              <button
                type="button"
                aria-label={"移除图片" + (index + 1)}
                disabled={busy}
                onClick={() => {
                  setPhotos((previous) =>
                    previous.filter((_, i) => i !== index),
                  );
                  setMessage("");
                }}
              >
                <X size={18} />
              </button>
            </figcaption>
          </figure>
        ))}
      </div>
      {error && (
        <p className="console-error" role="alert">
          {error}
        </p>
      )}
      <footer>
        <span role="status">{message}</span>
        <button
          type="button"
          className="primary-button"
          disabled={busy}
          onClick={() => void save()}
        >
          {busy ? "处理中…" : "保存"}
        </button>
      </footer>
    </div>
  );
}
