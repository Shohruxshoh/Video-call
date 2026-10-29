const ERRORS: Record<string, string> = {
  network: "Serverga ulanib bo'lmadi. Internetni tekshirib, qayta urinib ko'ring.",
  rate_limited: "Urinishlar juda ko'p. Bir necha daqiqadan keyin qayta urinib ko'ring.",
  invalid_username: "Foydalanuvchi nomi 3–24 belgi bo'lsin: lotin harflari, raqamlar, _ yoki nuqta.",
  invalid_display_name: 'Ismingizni yozing (40 belgigacha).',
  weak_password: "Parol kamida 8 belgidan iborat bo'lsin.",
  username_taken: 'Bu foydalanuvchi nomi band. Boshqasini tanlang.',
  bad_credentials: "Foydalanuvchi nomi yoki parol noto'g'ri.",
  invalid_invite: "Bu havola eskirgan yoki allaqachon ishlatilgan. Do'stingizdan yangi havola so'rang.",
  own_invite: "Bu o'zingizning havolangiz. Uni do'stingizga yuboring.",
  too_many_invites: "Faol havolalar juda ko'p. Keraksizlarini o'chiring.",
  unauthorized: 'Qaytadan kiring.',
  not_found: 'Topilmadi.',
  not_friends: "Xabar yuborilmadi: siz endi do'st emassiz.",
  invalid_body: 'Xabar juda uzun (4000 belgigacha).',
};

export const errorText = (code: string) => ERRORS[code] ?? "Nimadir noto'g'ri ketdi. Qayta urinib ko'ring.";

export const CALL_END: Record<string, string> = {
  hangup: "Qo'ng'iroq tugadi",
  hangup_self: "Qo'ng'iroq tugadi",
  rejected: "Qo'ng'iroq rad etildi",
  rejected_self: "Qo'ng'iroq rad etildi",
  cancelled: "Qo'ng'iroq bekor qilindi",
  timeout: 'Javob berilmadi',
  busy: "Do'stingiz hozir boshqa qo'ng'iroqda",
  busy_self: "Siz allaqachon qo'ng'iroqdasiz",
  offline: "Do'stingiz hozir tarmoqda emas",
  forbidden: "Bu foydalanuvchiga qo'ng'iroq qilib bo'lmaydi",
  lost: 'Aloqa uzilib qoldi',
  gone: "Qo'ng'iroq allaqachon tugagan",
  connect_failed: "Ulanib bo'lmadi. Internetni tekshirib, qayta urinib ko'ring.",
  no_connection: "Serverga ulanish yo'q. Internet tiklanishini kuting.",
  shutdown: "Server qayta ishga tushdi. Qayta qo'ng'iroq qiling.",
};
