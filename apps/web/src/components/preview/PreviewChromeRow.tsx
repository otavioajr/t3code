import { RefreshIcon } from "~/components/ui/refresh-icon";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  ExternalLink,
  MousePointerClick,
  PictureInPicture2,
} from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useRef,
  useState,
} from "react";

import type { BrowserHistoryEntry } from "~/browserHistoryStore";
import {
  Autocomplete,
  AutocompleteBareInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
} from "~/components/ui/autocomplete";
import { Button } from "~/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

import { type AddressBarSuggestion } from "./addressBarSuggestions";
import { useAddressBarSuggestions } from "./useAddressBarSuggestions";

interface Props {
  url: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  refreshDisabled: boolean;
  inputDisabled?: boolean | undefined;
  /** Owned by the caller so its shortcut handler can focus the address bar directly. */
  urlInputRef: RefObject<HTMLInputElement | null>;
  onBack: () => void;
  onForward: () => void;
  onRefresh: () => void;
  onStopLoading: () => void;
  onSubmit: (url: string) => void;
  onOpenInBrowser?: (() => void) | undefined;
  onCapture?: ((record: boolean) => void) | undefined;
  captureDisabled?: boolean | undefined;
  recording?: boolean | undefined;
  onPictureInPicture?: (() => void) | undefined;
  pictureInPicture?: boolean | undefined;
  pictureInPictureDisabled?: boolean | undefined;
  onPickElement?: (() => void) | undefined;
  pickActive?: boolean | undefined;
  pickDisabled?: boolean | undefined;
  pickDisabledReason?: string | undefined;
  trailingActions?: ReactNode;
  leadingActions?: ReactNode;
  /** The project's visited pages, offered as address bar suggestions while typing. */
  projectHistory?: ReadonlyArray<BrowserHistoryEntry> | undefined;
}

const NO_HISTORY: ReadonlyArray<BrowserHistoryEntry> = [];

const NOOP = () => {};

export function PreviewChromeRow({
  url,
  loading,
  canGoBack,
  canGoForward,
  refreshDisabled,
  inputDisabled,
  urlInputRef: inputRef,
  onBack,
  onForward,
  onRefresh,
  onStopLoading,
  onSubmit,
  onOpenInBrowser,
  onCapture,
  captureDisabled,
  recording,
  onPictureInPicture,
  pictureInPicture,
  pictureInPictureDisabled,
  onPickElement,
  pickActive,
  pickDisabled,
  pickDisabledReason,
  trailingActions,
  leadingActions,
  projectHistory = NO_HISTORY,
}: Props) {
  const [draft, setDraft] = useState(url);
  const [inputFocused, setInputFocused] = useState(false);
  const addressGroupRef = useRef<HTMLDivElement>(null);
  const suggestionHighlightedRef = useRef(false);
  const suggestions = useAddressBarSuggestions({
    query: draft,
    active: inputFocused,
    projectEntries: projectHistory,
  });

  const submit = (event?: FormEvent | KeyboardEvent) => {
    event?.preventDefault();
    const next = draft.trim();
    if (next.length === 0) return;
    onSubmit(next);
    inputRef.current?.blur();
  };

  return (
    <div className="relative">
      <form
        onSubmit={submit}
        className="flex h-10 min-h-10 shrink-0 items-center gap-1 border-b border-border/60 bg-background px-2 in-data-[preview-panel-mode=inline]:mb-3 in-data-[preview-panel-mode=inline]:h-7 in-data-[preview-panel-mode=inline]:min-h-7 in-data-[preview-panel-mode=inline]:border-b-transparent"
        data-surface-subheader
      >
        <div className="flex items-center gap-0.5" role="group" aria-label="Navigation">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={canGoBack ? onBack : NOOP}
                  disabled={!canGoBack}
                  aria-label="Back"
                  type="button"
                />
              }
            >
              <ArrowLeft />
            </TooltipTrigger>
            <TooltipPopup>Back</TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={canGoForward ? onForward : NOOP}
                  disabled={!canGoForward}
                  aria-label="Forward"
                  type="button"
                />
              }
            >
              <ArrowRight />
            </TooltipTrigger>
            <TooltipPopup>Forward</TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={refreshDisabled ? NOOP : loading ? onStopLoading : onRefresh}
                  disabled={refreshDisabled}
                  aria-label={loading ? "Stop" : "Refresh"}
                  type="button"
                />
              }
            >
              <RefreshIcon refreshing={loading} />
            </TooltipTrigger>
            <TooltipPopup>{loading ? "Stop" : "Refresh"}</TooltipPopup>
          </Tooltip>
        </div>

        {leadingActions}

        <InputGroup ref={addressGroupRef} variant="ghost" className="group/address h-7 flex-1">
          <Autocomplete
            items={suggestions}
            mode="none"
            value={inputFocused ? draft : url}
            itemToStringValue={(item: AddressBarSuggestion) => item.url}
            onValueChange={(next, details) => {
              // Escape clears a closed popup's input; the key handler below restores the URL instead.
              if (details.reason === "input-change") setDraft(next);
            }}
            onItemHighlighted={(item) => {
              suggestionHighlightedRef.current = item !== undefined;
            }}
          >
            <Tooltip>
              <TooltipTrigger
                render={
                  <AutocompleteBareInput
                    ref={inputRef}
                    onFocus={() => {
                      setDraft(url);
                      setInputFocused(true);
                      queueMicrotask(() => inputRef.current?.select());
                    }}
                    onBlur={() => {
                      setInputFocused(false);
                    }}
                    onKeyDown={(event) => {
                      if (event.nativeEvent.isComposing || event.keyCode === 229) {
                        // A trusted Enter would still submit the form implicitly.
                        if (event.key === "Enter") event.preventDefault();
                        return;
                      }
                      // Enter on a highlighted suggestion opens that suggestion instead.
                      if (event.key === "Enter" && !suggestionHighlightedRef.current) submit(event);
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setDraft(url);
                        inputRef.current?.blur();
                      }
                    }}
                    placeholder="Search or enter URL"
                    aria-label="Search or enter URL"
                    data-workspace-focus-default
                    spellCheck={false}
                    disabled={inputDisabled}
                    data-preview-url-input
                    render={<InputGroupInput nativeInput size="sm" />}
                  />
                }
              />
            </Tooltip>
            <AutocompletePopup anchor={addressGroupRef}>
              <AutocompleteList>
                {(suggestion: AddressBarSuggestion) => (
                  <AutocompleteItem
                    key={suggestion.url}
                    value={suggestion}
                    onClick={() => {
                      onSubmit(suggestion.url);
                      inputRef.current?.blur();
                    }}
                  >
                    <span className="flex min-w-0 flex-1 items-baseline gap-2">
                      <span className="shrink-0 truncate">
                        {suggestion.title ?? suggestion.url}
                      </span>
                      {suggestion.title ? (
                        <span className="min-w-0 truncate text-xs text-muted-foreground">
                          {suggestion.url}
                        </span>
                      ) : null}
                    </span>
                  </AutocompleteItem>
                )}
              </AutocompleteList>
            </AutocompletePopup>
          </Autocomplete>
          {onOpenInBrowser && !inputFocused ? (
            <InputGroupAddon align="inline-end">
              {}
              <span className="pointer-events-none flex opacity-0 transition-opacity focus-within:pointer-events-auto focus-within:opacity-100 group-hover/address:pointer-events-auto group-hover/address:opacity-100">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={onOpenInBrowser}
                        aria-label="Open in system browser"
                        type="button"
                      />
                    }
                  >
                    <ExternalLink />
                  </TooltipTrigger>
                  <TooltipPopup>Open in system browser</TooltipPopup>
                </Tooltip>
              </span>
            </InputGroupAddon>
          ) : null}
        </InputGroup>

        {onPickElement ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant={pickActive ? "secondary" : "ghost"}
                  size="icon-xs"
                  onClick={onPickElement}
                  disabled={pickDisabled}
                  aria-label={pickActive ? "Cancel annotation" : "Annotate preview"}
                  aria-pressed={pickActive ? "true" : "false"}
                  type="button"
                />
              }
            >
              <MousePointerClick className={cn(pickActive && "text-primary")} />
            </TooltipTrigger>
            <TooltipPopup>
              {pickDisabled && pickDisabledReason
                ? pickDisabledReason
                : pickActive
                  ? "Cancel annotation (Esc)"
                  : "Annotate elements, regions, and drawings"}
            </TooltipPopup>
          </Tooltip>
        ) : null}
        {onCapture ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant={recording ? "secondary" : "ghost"}
                  size="icon-xs"
                  onClick={(event) => onCapture(event.shiftKey)}
                  aria-label={recording ? "Stop recording" : "Capture screenshot"}
                  type="button"
                  className="relative"
                  disabled={captureDisabled}
                />
              }
            >
              <Camera className={cn(recording && "text-destructive")} />
              {recording ? (
                <span className="absolute right-0.5 top-0.5 size-1.5 motion-safe:animate-status-pulse rounded-full bg-destructive" />
              ) : null}
            </TooltipTrigger>
            <TooltipPopup>
              {recording ? "Stop recording" : "Screenshot · Shift-click to record"}
            </TooltipPopup>
          </Tooltip>
        ) : null}
        {onPictureInPicture ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant={pictureInPicture ? "secondary" : "ghost"}
                  size="icon-xs"
                  onClick={onPictureInPicture}
                  aria-label={
                    pictureInPicture ? "Close floating preview" : "Float preview over chat"
                  }
                  aria-pressed={pictureInPicture ? "true" : "false"}
                  type="button"
                  disabled={pictureInPictureDisabled}
                />
              }
            >
              <PictureInPicture2 className={cn(pictureInPicture && "text-primary")} />
            </TooltipTrigger>
            <TooltipPopup>
              {pictureInPicture ? "Close floating preview" : "Float preview over chat"}
            </TooltipPopup>
          </Tooltip>
        ) : null}
        {trailingActions}
      </form>
      <div
        aria-hidden
        data-loading={loading}
        className="preview-loading-progress pointer-events-none absolute bottom-0 left-0 z-10 h-0.5 w-full origin-left rounded-r-full bg-primary"
        style={{ boxShadow: "0 0 6px 1px var(--color-ring)" }}
      />
    </div>
  );
}
