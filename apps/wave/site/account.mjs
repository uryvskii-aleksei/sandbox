const storageKey = 'wave:ratings';

function readGuestRatings() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
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

  let guestRatings = readGuestRatings();
  let account = null;
  let accountRatings = {};
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
    document.querySelector('#login-hint').hidden = !register;
    document.querySelector('#password-hint').hidden = !register;
    login.setAttribute('aria-describedby', 'login-hint');
    password.setAttribute('aria-describedby', 'password-hint');
    password.autocomplete = register ? 'new-password' : 'current-password';
    if (register) login.pattern = '[A-Za-z0-9_]{3,24}';
    else login.removeAttribute('pattern');
    password.minLength = register ? 12 : 1;
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

  dialog.addEventListener('close', () => {
    password.value = '';
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
        }),
      );
      guestRatings = {};
      try {
        localStorage.removeItem(storageKey);
      } catch {
        // Сервер уже сохранил оценки.
      }
      dialog.close();
      message.textContent = 'Оценки будут сохраняться в вашем аккаунте.';
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
  restoreAccount()
    .catch(() => {})
    .finally(() => {
      busy = false;
      render();
    });

  return {
    get ratings() {
      return account ? accountRatings : guestRatings;
    },
    get busy() {
      return busy && account !== null;
    },
    async rate(id, direction) {
      const value = this.ratings[id] === direction ? 0 : direction;
      message.textContent = '';
      if (!account) {
        if (value) guestRatings[id] = value;
        else delete guestRatings[id];
        try {
          localStorage.setItem(storageKey, JSON.stringify(guestRatings));
        } catch {
          message.textContent = 'Браузер сохранит оценки только до закрытия страницы.';
        }
        render();
        return;
      }
      if (busy) return;
      busy = true;
      render();
      try {
        apply(await request({ action: 'rate', id, value }));
      } catch (error) {
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
