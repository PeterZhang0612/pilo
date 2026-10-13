use std::{
    io::{self, Write},
    sync::Arc,
};

use pilo_protocol::Envelope;
use tokio::sync::{OwnedSemaphorePermit, Semaphore, mpsc};

const OUTPUT_MAX_BYTES: usize = 64 * 1024 * 1024;

pub(crate) struct QueuedOutput {
    pub(crate) message: Envelope,
    pub(crate) _bytes: OwnedSemaphorePermit,
}

#[derive(Clone)]
pub(crate) struct ServerWriter {
    sender: mpsc::Sender<QueuedOutput>,
    bytes: Arc<Semaphore>,
    runtime: tokio::runtime::Handle,
}

#[derive(Default)]
struct PayloadSize(usize);

impl Write for PayloadSize {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0 = self.0.saturating_add(bytes.len());
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl ServerWriter {
    pub(crate) fn new(sender: mpsc::Sender<QueuedOutput>) -> Self {
        Self {
            sender,
            bytes: Arc::new(Semaphore::new(OUTPUT_MAX_BYTES)),
            runtime: tokio::runtime::Handle::current(),
        }
    }

    pub(crate) async fn send(&self, mut message: Envelope) -> Result<(), String> {
        let (value, binary, overhead) = match &message {
            Envelope::Request {
                method,
                params,
                binary,
                ..
            } => (Some(params), binary, method.len()),
            Envelope::Response {
                result,
                binary,
                error,
                ..
            } => (
                result.as_ref(),
                binary,
                error.as_ref().map_or(0, |error| {
                    error.code.len().saturating_add(error.message.len())
                }),
            ),
            Envelope::Event {
                stream_id,
                event,
                data,
                binary,
            } => (
                Some(data),
                binary,
                stream_id.len().saturating_add(event.len()),
            ),
        };
        let mut size = PayloadSize(overhead.saturating_add(64));
        if let Some(value) = value {
            serde_json::to_writer(&mut size, value).map_err(|error| error.to_string())?;
        }
        let mut bytes = binary
            .iter()
            .fold(size.0, |sum, payload| sum.saturating_add(payload.len()));
        if bytes > OUTPUT_MAX_BYTES {
            if let Envelope::Response { id, .. } = &message {
                message = Envelope::error(
                    *id,
                    "output_too_large",
                    "server output exceeds the byte budget",
                );
                bytes = 256;
            } else {
                return Err("server output exceeds the byte budget".to_owned());
            }
        }
        // Reserve a queue slot first: waiting producers must not retain byte permits.
        let slot = self
            .sender
            .reserve()
            .await
            .map_err(|_| "server output is closed".to_owned())?;
        let permit = Arc::clone(&self.bytes)
            .acquire_many_owned(bytes as u32)
            .await
            .map_err(|_| "server output is closed".to_owned())?;
        slot.send(QueuedOutput {
            message,
            _bytes: permit,
        });
        Ok(())
    }

    pub(crate) fn blocking_send(&self, message: Envelope) -> Result<(), String> {
        self.runtime.block_on(self.send(message))
    }
}
