function sixDigit() {
  return String(100000 + Math.floor(Math.random() * 900000));
}

function isRoomCode(value) {
  return typeof value === "string" && /^[0-9]{6}$/.test(value);
}

function roomOpen(current) {
  return current && current.data && current.data.open === true;
}

function seatsOf(data) {
  return Array.isArray(data && data.seats) ? data.seats : [];
}

async function putWithRetry(ctx, code, apply) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = await ctx.room.get(code);
    const next = apply(current);
    if (next && next.ok === false) return next;
    const put = await ctx.room.put(code, next.data, { n: current.n });
    if (put.ok) return { ok: true, room: code, data: next.data, n: put.n };
  }
  return { ok: false, error: "Try again." };
}

export default {
  async run(input, ctx) {
    const action = input && input.action;

    if (action === "create") {
      for (let attempt = 0; attempt < 12; attempt++) {
        const code = sixDigit();
        const current = await ctx.room.get(code);
        if (roomOpen(current) || current.n > 0) continue;
        const data = { open: true, seats: [{ presses: 0 }] };
        const put = await ctx.room.put(code, data, { n: 0 });
        if (!put.ok) continue;
        await ctx.db.set({ room: code, seat: 0, presses: 0 });
        await ctx.public.put({ room: code, seat: 0, presses: 0 });
        return { ok: true, room: code };
      }
      return { ok: false, error: "Could not create a room. Try again." };
    }

    if (action === "join") {
      const code = String(input.room || "").trim();
      if (!isRoomCode(code)) {
        return { ok: false, error: "Enter a 6-digit code." };
      }

      const priv = await ctx.db.get();
      if (priv.room === code && typeof priv.seat === "number") {
        await ctx.public.put({
          room: code,
          seat: priv.seat,
          presses: priv.presses || 0,
        });
        return { ok: true, room: code };
      }

      const joined = await putWithRetry(ctx, code, (current) => {
        if (!roomOpen(current)) {
          return { ok: false, error: "Room not found." };
        }
        const seats = [...seatsOf(current.data), { presses: 0 }];
        return { data: { ...current.data, open: true, seats } };
      });
      if (!joined.ok) return joined;

      const seat = seatsOf(joined.data).length - 1;
      await ctx.db.set({ room: code, seat, presses: 0 });
      await ctx.public.put({ room: code, seat, presses: 0 });
      return { ok: true, room: code };
    }

    if (action === "press") {
      const code = String(input.room || "").trim();
      const priv = await ctx.db.get();
      if (!priv.room || priv.room !== code || typeof priv.seat !== "number") {
        return { ok: false, error: "You are not in this room." };
      }

      const pressed = await putWithRetry(ctx, code, (current) => {
        if (!roomOpen(current)) {
          return { ok: false, error: "Room not found." };
        }
        const seats = seatsOf(current.data).map((seat) => ({ ...seat }));
        if (!seats[priv.seat]) {
          return { ok: false, error: "You are not in this room." };
        }
        seats[priv.seat].presses = (Number(seats[priv.seat].presses) || 0) + 1;
        return { data: { ...current.data, open: true, seats } };
      });
      if (!pressed.ok) return pressed;

      const presses = seatsOf(pressed.data)[priv.seat].presses;
      await ctx.db.set({ room: code, seat: priv.seat, presses });
      await ctx.public.put({ room: code, seat: priv.seat, presses });
      return { ok: true, room: code, presses };
    }

    if (action === "leave") {
      const priv = await ctx.db.get();
      await ctx.public.put({ room: "_", left: true, presses: 0 });
      await ctx.db.set({});
      return { ok: true, room: priv.room || null };
    }

    return { ok: false, error: "Unknown action." };
  },
};
