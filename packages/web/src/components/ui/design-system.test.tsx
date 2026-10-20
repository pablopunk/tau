import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Alert, AlertDescription } from "./alert";
import { ClosableTab } from "./closable-tab";
import { Combobox } from "./combobox";
import { CopyButton } from "./copy-button";
import { DropZone } from "./drop-zone";
import { Field, FieldError, FieldLabel } from "./field";
import { ImageThumbnail } from "./image-thumbnail";
import { MorphText } from "./morph-text";
import { Spinner } from "./spinner";
import { StatusDot } from "./status-dot";
import { Switch } from "./switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

const OPTIONS = [
  { value: "home", label: "Home", group: "Projects" },
  { value: "api", label: "API", group: "Projects" },
  { value: "repo", label: "Cloning repo", group: "Git", disabled: true, hint: "Cloning" },
];

describe("Combobox", () => {
  it("shows groups, filters by search, chooses an option and shows it", async () => {
    const onChange = vi.fn();
    render(<Combobox options={OPTIONS} value="home" onChange={onChange} aria-label="Project" />);
    const trigger = screen.getByRole("combobox", { name: "Project" });
    expect(trigger).toHaveTextContent("Home");
    await userEvent.click(trigger);
    expect(screen.getByText("Git")).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText("Search…"), "ap");
    await userEvent.click(screen.getByRole("option", { name: /API/ }));
    expect(onChange).toHaveBeenCalledWith("api");
  });

  it("hides the search box when not searchable", async () => {
    render(<Combobox options={OPTIONS} value="home" onChange={vi.fn()} searchable={false} />)
    await userEvent.click(screen.getByRole("combobox"))
    expect(screen.queryByPlaceholderText("Search…")).toBeNull()
  })

  it("does not choose a disabled option and shows its hint", async () => {
    const onChange = vi.fn();
    render(<Combobox options={OPTIONS} value={null} onChange={onChange} placeholder="Pick one" />);
    await userEvent.click(screen.getByRole("combobox"));
    const disabled = screen.getByRole("option", { name: /Cloning repo/ });
    expect(disabled).toHaveAttribute("aria-disabled", "true");
    expect(disabled).toHaveTextContent("Cloning");
    await userEvent.click(disabled);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("MorphText", () => {
  it("shows its text as one readable string and follows changes", () => {
    const { container, rerender } = render(<MorphText>Running</MorphText>);
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(container.querySelector("[data-slot=morph-text]")).not.toBeNull();
    rerender(<MorphText>Failed</MorphText>);
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("accepts numbers and passes span props through", () => {
    render(<MorphText data-testid="count" className="text-xs">{3}</MorphText>);
    expect(screen.getByTestId("count")).toHaveClass("inline-flex", "text-xs");
    expect(screen.getByTestId("count")).toHaveTextContent("3");
  });
});

describe("StatusDot", () => {
  it.each([
    ["running", "Running"],
    ["error", "Failed"],
    ["unseen", "New activity"],
  ] as const)("labels %s", (status, label) => {
    render(<StatusDot status={status} />);
    expect(screen.getByRole("img", { name: label })).toHaveAttribute("data-status", status);
  });
});

describe("CopyButton", () => {
  it("copies the text and confirms", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<CopyButton text="hello" />);
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("hello");
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });
});

describe("ImageThumbnail", () => {
  it("shows the image with remove and open buttons", async () => {
    const onRemove = vi.fn();
    const onOpen = vi.fn();
    render(<ImageThumbnail src="data:image/png;base64,AAAA" alt="shot.png" onRemove={onRemove} onOpen={onOpen} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove shot.png" }));
    await userEvent.click(screen.getByRole("button", { name: "Open shot.png" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe("DropZone", () => {
  const dataTransfer = (files: File[]) => ({ types: ["Files"], files });

  it("shows an overlay while files are dragged over and passes dropped files on", () => {
    const onFiles = vi.fn();
    render(
      <DropZone onFiles={onFiles} label="Drop images">
        <p>content</p>
      </DropZone>,
    );
    const zone = screen.getByText("content").parentElement as HTMLElement;
    const file = new File(["x"], "a.png", { type: "image/png" });
    fireEvent.dragEnter(zone, { dataTransfer: dataTransfer([file]) });
    expect(screen.getByText("Drop images")).toBeInTheDocument();
    fireEvent.drop(zone, { dataTransfer: dataTransfer([file]) });
    expect(onFiles).toHaveBeenCalledWith([file]);
    expect(screen.queryByText("Drop images")).not.toBeInTheDocument();
  });

  it("ignores drags that carry no files", () => {
    render(
      <DropZone onFiles={vi.fn()}>
        <p>content</p>
      </DropZone>,
    );
    fireEvent.dragEnter(screen.getByText("content").parentElement as HTMLElement, {
      dataTransfer: { types: ["text/plain"], files: [] },
    });
    expect(screen.queryByText("Drop to attach")).not.toBeInTheDocument();
  });
});

describe("Tabs, Switch, Field, Alert and Spinner", () => {
  it("switches tabs", async () => {
    render(
      <Tabs defaultValue="folder">
        <TabsList>
          <TabsTrigger value="folder">Folder</TabsTrigger>
          <TabsTrigger value="git">Git URL</TabsTrigger>
        </TabsList>
        <TabsContent value="folder">folder form</TabsContent>
        <TabsContent value="git">git form</TabsContent>
      </Tabs>,
    );
    await userEvent.click(screen.getByRole("tab", { name: "Git URL" }));
    expect(screen.getByText("git form")).toBeInTheDocument();
  });

  it("toggles a labelled switch", async () => {
    const onCheckedChange = vi.fn();
    render(
      <Field>
        <FieldLabel htmlFor="s">Notifications</FieldLabel>
        <Switch id="s" onCheckedChange={onCheckedChange} />
        <FieldError>Permission denied</FieldError>
      </Field>,
    );
    await userEvent.click(screen.getByRole("switch", { name: "Notifications" }));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole("alert")).toHaveTextContent("Permission denied");
  });

  it("renders an alert and a spinner", () => {
    render(
      <>
        <Alert variant="destructive">
          <AlertDescription>Clone failed</AlertDescription>
        </Alert>
        <Spinner />
      </>,
    );
    expect(screen.getByText("Clone failed")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  });
});

describe("ClosableTab", () => {
  function setup(onClose?: () => void, ended?: boolean) {
    render(
      <Tabs value="a">
        <TabsList aria-label="Panes">
          <ClosableTab value="a" title="sh" onClose={onClose} ended={ended} />
        </TabsList>
      </Tabs>,
    );
  }

  it("closes with the button, a middle click and Delete", async () => {
    const onClose = vi.fn();
    setup(onClose);
    await userEvent.click(screen.getByRole("button", { name: "Close sh" }));
    fireEvent(screen.getByRole("tab"), new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    screen.getByRole("tab").focus();
    await userEvent.keyboard("{Delete}");
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("has no close button without onClose and marks an ended tab", () => {
    setup(undefined, true);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("tab")).toHaveAttribute("data-ended", "true");
  });
});
