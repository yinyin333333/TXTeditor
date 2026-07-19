use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc::{self, Receiver, Sender},
    Arc,
};
use std::time::Duration;

use tokio::sync::oneshot;

const CLIPBOARD_TIMEOUT: Duration = Duration::from_millis(1_000);

type ClipboardResponse<T> = oneshot::Receiver<Result<T, String>>;

enum ClipboardRequest {
    Read {
        reply: oneshot::Sender<Result<String, String>>,
        lease: ClipboardLease,
    },
    Write {
        text: String,
        reply: oneshot::Sender<Result<(), String>>,
        lease: ClipboardLease,
    },
    Shutdown,
}

struct ClipboardLease {
    busy: Arc<AtomicBool>,
}

impl ClipboardLease {
    fn acquire(busy: &Arc<AtomicBool>) -> Result<Self, String> {
        busy.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| Self {
                busy: Arc::clone(busy),
            })
            .map_err(|_| "Clipboard is still busy with a previous native operation.".to_string())
    }
}

impl Drop for ClipboardLease {
    fn drop(&mut self) {
        self.busy.store(false, Ordering::Release);
    }
}

pub(crate) struct ClipboardService {
    sender: Sender<ClipboardRequest>,
    busy: Arc<AtomicBool>,
}

impl ClipboardService {
    pub(crate) fn new() -> Self {
        let (sender, receiver) = mpsc::channel();
        let busy = Arc::new(AtomicBool::new(false));
        if let Err(error) = std::thread::Builder::new()
            .name("txteditor-clipboard".to_string())
            .spawn(move || clipboard_worker(receiver))
        {
            eprintln!("Failed to start clipboard worker: {error}");
        }
        Self { sender, busy }
    }

    fn request_read(&self) -> Result<ClipboardResponse<String>, String> {
        let lease = ClipboardLease::acquire(&self.busy)?;
        let (reply, response) = oneshot::channel();
        self.sender
            .send(ClipboardRequest::Read { reply, lease })
            .map_err(|_| "Clipboard worker is unavailable.".to_string())?;
        Ok(response)
    }

    fn request_write(&self, text: String) -> Result<ClipboardResponse<()>, String> {
        let lease = ClipboardLease::acquire(&self.busy)?;
        let (reply, response) = oneshot::channel();
        self.sender
            .send(ClipboardRequest::Write { text, reply, lease })
            .map_err(|_| "Clipboard worker is unavailable.".to_string())?;
        Ok(response)
    }

    pub(crate) fn shutdown(&self) {
        let _ = self.sender.send(ClipboardRequest::Shutdown);
    }
}

fn clipboard_worker(receiver: Receiver<ClipboardRequest>) {
    let mut clipboard = None;
    while let Ok(request) = receiver.recv() {
        match request {
            ClipboardRequest::Read { reply, lease } => {
                let result =
                    with_clipboard(&mut clipboard, "read", |clipboard| clipboard.get_text());
                drop(lease);
                let _ = reply.send(result);
            }
            ClipboardRequest::Write { text, reply, lease } => {
                let result = with_clipboard(&mut clipboard, "write", |clipboard| {
                    clipboard.set_text(text)
                });
                drop(lease);
                let _ = reply.send(result);
            }
            ClipboardRequest::Shutdown => break,
        }
    }
}

fn with_clipboard<T>(
    clipboard: &mut Option<arboard::Clipboard>,
    operation: &str,
    action: impl FnOnce(&mut arboard::Clipboard) -> Result<T, arboard::Error>,
) -> Result<T, String> {
    if clipboard.is_none() {
        *clipboard = Some(
            arboard::Clipboard::new()
                .map_err(|error| format!("Clipboard initialization failed: {error}"))?,
        );
    }
    action(clipboard.as_mut().expect("clipboard initialized above"))
        .map_err(|error| format!("Clipboard {operation} failed: {error}"))
}

async fn await_response<T>(operation: &str, response: ClipboardResponse<T>) -> Result<T, String> {
    match tokio::time::timeout(CLIPBOARD_TIMEOUT, response).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err(format!("Clipboard {operation} worker stopped.")),
        Err(_) => Err(format!(
            "Clipboard {operation} timed out after {} ms.",
            CLIPBOARD_TIMEOUT.as_millis()
        )),
    }
}

#[tauri::command]
pub(crate) async fn read_clipboard_text(
    service: tauri::State<'_, ClipboardService>,
) -> Result<String, String> {
    let response = service.request_read()?;
    await_response("read", response).await
}

#[tauri::command]
pub(crate) async fn write_clipboard_text(
    text: String,
    service: tauri::State<'_, ClipboardService>,
) -> Result<(), String> {
    let response = service.request_write(text)?;
    await_response("write", response).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lease_serializes_native_calls() {
        let busy = Arc::new(AtomicBool::new(false));
        let first = ClipboardLease::acquire(&busy).expect("first lease");
        assert!(ClipboardLease::acquire(&busy).is_err());
        drop(first);
        assert!(ClipboardLease::acquire(&busy).is_ok());
    }

    #[test]
    fn disconnected_worker_releases_lease() {
        let (sender, receiver) = mpsc::channel();
        drop(receiver);
        let service = ClipboardService {
            sender,
            busy: Arc::new(AtomicBool::new(false)),
        };
        assert!(service.request_read().is_err());
        assert!(!service.busy.load(Ordering::Acquire));
    }
}
