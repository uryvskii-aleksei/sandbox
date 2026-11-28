const ratingsKey = 'wave:ratings';
const playbackKey = 'wave:playback';
const ratingFeedback = {
  1: 'Похожие клипы будут появляться чаще.',
  0: 'Оценка снята.',
  '-1': 'Клип скрыт из подборки. Похожие будут появляться реже.',
};

function readGuestSignals(key) {
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    return Object.fromEntries(
      Object.entries(saved ?? {}).filter(
        ([id, value]) => /^[a-z0-9-]{1,64}$/.test(id) && (value === 1 || value === -1),
      ),
    );
  } catch {
    return {};
  }
}

export function setupAccount(onChange) {
  const button = document.querySelector('#account-button');
  const username = document.querySelector('#username');
  const message = document.querySelector('#account-message');
  const dialog = document.querySelector('#account-dialog');
  const form = document.querySelector('#account-form');
  const login = form.elements.login;
  const password = form.elements.password;
  const submit = document.querySelector('#account-submit');
  const modeButton = document.querySelector('#account-mode');
  const errorMessage = document.querySelector('#form-message');

  let guestRatings = readGuestSignals(ratingsKey);
  let guestPlayback = readGuestSignals(playbackKey);
  let account = null;
  let accountRatings = {};
  let accountPlayback = {};
  let playbackWrites = Promise.resolve();
  let csrf = '';
  let register = false;
  let busy = false;

  function render() {
    username.hidden = account === null;
    username.textContent = account ?? '';
    button.textContent = account ? 'Выйти' : 'Войти';
    button.disabled = busy;
    login.disabled = busy;
    password.disabled = busy;
    submit.disabled = busy;
    modeButton.disabled = busy;
    onChange();
  }

  async function request(body) {
    const response = await fetch('./api.php', {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify({ ...body, csrf }) : undefined,
      signal: AbortSignal.timeout(8000),
    });
    const data = await response.json();
    if (!response.ok) {
      const failure = new Error(data.error);
      failure.status = response.status;
      throw failure;
    }
    return data;
  }

  function apply(data) {
    if (csrf !== data.csrf || account !== data.username) accountPlayback = data.playback ?? {};
    account = data.username;
    accountRatings = data.ratings;
    csrf = data.csrf;
  }

  async function restoreAccount() {
    apply(await request());
  }

  function setMode(create) {
    register = create;
    const action = register ? 'Создать аккаунт' : 'Войти';
    document.querySelector('#account-title').textContent = action;
    submit.textContent = action;
    modeButton.textContent = register ? 'Уже есть аккаунт? Войти' : 'Создать аккаунт';
    login.type = register ? 'email' : 'text';
    password.autocomplete = register ? 'new-password' : 'current-password';
    errorMessage.textContent = '';
  }

  button.addEventListener('click', async () => {
    message.textContent = '';
    if (!account) {
      form.reset();
      setMode(false);
      dialog.showModal();
      return;
    }
    busy = true;
    render();
    try {
      await playbackWrites;
      apply(await request({ action: 'logout' }));
      message.textContent = 'Вы вышли из аккаунта.';
    } catch (error) {
      message.textContent = error.status ? error.message : 'Не удалось выйти. Попробуйте снова.';
    } finally {
      busy = false;
      render();
    }
  });

  modeButton.addEventListener('click', () => {
    setMode(!register);
    login.focus();
  });

  button.addEventListener('blur', () => button.classList.remove('restored-focus'));

  dialog.addEventListener('cancel', () => button.classList.add('restored-focus'));

  dialog.addEventListener('close', () => {
    password.value = '';
    if (document.activeElement !== button) button.classList.remove('restored-focus');
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    const credentials = { login: login.value, password: password.value };
    busy = true;
    errorMessage.textContent = '';
    render();
    try {
      if (!csrf) await restoreAccount();
      apply(
        await request({
          action: register ? 'register' : 'login',
          ...credentials,
          ratings: guestRatings,
          playback: guestPlayback,
        }),
      );
      guestRatings = {};
      guestPlayback = {};
      try {
        localStorage.removeItem(ratingsKey);
        localStorage.removeItem(playbackKey);
      } catch {
        // Сервер уже сохранил предпочтения.
      }
      dialog.close();
      message.textContent = '';
    } catch (error) {
      errorMessage.textContent = error.status
        ? error.message
        : 'Аккаунт временно недоступен. Попробуйте снова.';
      if (!dialog.open) message.textContent = errorMessage.textContent;
      if (error.status === 403) csrf = '';
    } finally {
      busy = false;
      render();
      if (!dialog.open) button.focus();
    }
  });

  // Восстанавливаем профиль, пока гостевой плеер загружает каталог.
  busy = true;
  const ready = restoreAccount()
    .catch(() => {})
    .finally(() => {
      busy = false;
      render();
    });

  return {
    ready,
    get ratings() {
      return account ? accountRatings : guestRatings;
    },
    get playback() {
      return account ? accountPlayback : guestPlayback;
    },
    recordPlayback(id, value) {
      if (!account) {
        guestPlayback[id] = value;
        try {
          localStorage.setItem(playbackKey, JSON.stringify(guestPlayback));
        } catch {
          // Предпочтение доступно до закрытия страницы.
        }
        return;
      }
      accountPlayback[id] = value;
      const token = csrf;
      playbackWrites = playbackWrites.then(async () => {
        if (csrf !== token) return;
        try {
          await request({ action: 'playback', id, value });
        } catch (error) {
          if (csrf !== token || (error.status && error.status < 500)) return;
          // Повторная запись того же сигнала безопасна после сетевого сбоя.
          try {
            await request({ action: 'playback', id, value });
          } catch {}
        }
      });
    },
    get busy() {
      return busy;
    },
    async rate(id, direction) {
      if (busy) return;
      const value = this.ratings[id] === direction ? 0 : direction;
      const ratings = { ...this.ratings };
      if (value) ratings[id] = value;
      else delete ratings[id];
      message.textContent = '';
      const feedback = ratingFeedback[value];
      if (!account) {
        guestRatings = ratings;
        try {
          localStorage.setItem(ratingsKey, JSON.stringify(guestRatings));
          message.textContent = feedback;
        } catch {
          message.textContent = 'Браузер сохранит оценки только до закрытия страницы.';
        }
        render();
        return;
      }
      const previousRatings = accountRatings;
      accountRatings = ratings;
      busy = true;
      render();
      try {
        apply(await request({ action: 'rate', id, value }));
        message.textContent = feedback;
      } catch (error) {
        accountRatings = previousRatings;
        if (error.status === 401 || error.status === 403) {
          account = null;
          csrf = '';
          message.textContent = 'Войдите снова, чтобы сохранить оценку в аккаунте.';
        } else {
          message.textContent = 'Не удалось сохранить оценку. Попробуйте снова.';
        }
      } finally {
        busy = false;
        render();
      }
    },
  };
}
