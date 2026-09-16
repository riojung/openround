import { io } from "socket.io-client";
import { API_URL } from "./api";

export function withRealtimeReceipt<T>(handler: (envelope: T) => void) {
  return (envelope: T, acknowledge?: () => void) => {
    acknowledge?.();
    handler(envelope);
  };
}

export function createRealtimeClient() {
  return io(API_URL, {
    autoConnect: false,
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4_000,
    timeout: 8_000,
  });
}
