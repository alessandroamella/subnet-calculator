const netElem = document.getElementById("original-network");
const hostsElem = document.getElementById("host-number");
const maskElem = document.getElementById("subnet-mask");
const slashElem = document.getElementById("mask-slash");

let currentController;

const isIp = str => str && str.split(".").length > 3;

const checkIp = async ip => {
  if (netElem.classList.contains("border-danger")) {
    netElem.classList.remove("border-danger");
  }
  if (!netElem.classList.contains("border-warning")) {
    netElem.classList.add("border-warning");
  }
  netElem.classList.add("border-warning");
  try {
    if (currentController) {
      currentController.abort();
    }
    currentController = new AbortController();
    await axios.get("/valid-ip", { params: { ip }, signal: currentController.signal });
    if (netElem.classList.contains("border-warning")) {
      netElem.classList.remove("border-warning");
    }
    return { isErr: false };
  } catch (err) {
    return { isErr: true, err: err.response.data };
  }
};

const checkMask = async mask => {
  if (maskElem.classList.contains("border-danger")) {
    maskElem.classList.remove("border-danger");
  }
  if (!maskElem.classList.contains("border-warning")) {
    maskElem.classList.add("border-warning");
  }
  maskElem.classList.add("border-warning");
  try {
    if (currentController) {
      currentController.abort();
    }
    currentController = new AbortController();
    const { data } = await axios.get("/valid-mask", {
      params: { mask },
      signal: currentController.signal
    });
    if (maskElem.classList.contains("border-warning")) {
      maskElem.classList.remove("border-warning");
    }
    hostsElem.value = data.hosts;
    slashElem.value = data.slash;
    return { isErr: false };
  } catch (err) {
    return { isErr: true, err: err.response.data };
  }
};

const isNormalInteger = str => {
  const n = Math.floor(Number(str));
  return n !== Number.POSITIVE_INFINITY && String(n) === str && n >= 0;
};

const netCorrect = () => {
  isNetError = false;
  if (netElem.classList.contains("border-warning")) {
    netElem.classList.remove("border-warning");
  }
  if (netElem.classList.contains("border-danger")) {
    netElem.classList.remove("border-danger");
  }
  if (!netElem.classList.contains("border-success")) {
    netElem.classList.add("border-success");
  }
};

const netWrong = err => {
  isNetError = true;
  if (!netElem.classList.contains("border-danger")) {
    netElem.classList.add("border-danger");
  }
  if (netElem.classList.contains("border-success")) {
    netElem.classList.remove("border-success");
  }
  if (err) {
    document.getElementById("subnet-bad").textContent = err;
  }
};

let isNetError = true;
netElem.addEventListener("input", async () => {
  if (!isIp(netElem.value)) {
    isNetError = true;
    if (netElem.classList.contains("border-success")) {
      netElem.classList.remove("border-success");
    }
    if (netElem.classList.contains("border-warning")) {
      netElem.classList.remove("border-warning");
    }
    if (netElem.classList.contains("border-danger")) {
      netElem.classList.remove("border-danger");
    }
    return;
  }
  const checkedIp = await checkIp(netElem.value);
  if (!checkedIp.isErr) netCorrect();
  else netWrong(checkedIp.err);
  hasTyped();
});

const hostCorrect = () => {
  isHostError = false;
  if (hostsElem.classList.contains("border-danger")) {
    hostsElem.classList.remove("border-danger");
  }
  if (!hostsElem.classList.contains("border-success")) {
    hostsElem.classList.add("border-success");
  }
};

const hostWrong = () => {
  isHostError = true;
  if (!hostsElem.classList.contains("border-danger")) {
    hostsElem.classList.add("border-danger");
  }
  if (hostsElem.classList.contains("border-success")) {
    hostsElem.classList.remove("border-success");
  }
};

let isHostError = true;
hostsElem.addEventListener("input", async () => {
  const h = Number.parseInt(hostsElem.value);
  if (isNormalInteger(hostsElem.value) && h > 0 && h <= 16777214) {
    await getSubnet(hostsElem.value, null, null);
    hostCorrect();
  } else hostWrong();
  hasTyped();
});

const maskCorrect = () => {
  isMaskError = false;
  if (maskElem.classList.contains("border-warning")) {
    maskElem.classList.remove("border-warning");
  }
  if (maskElem.classList.contains("border-danger")) {
    maskElem.classList.remove("border-danger");
  }
  if (!maskElem.classList.contains("border-success")) {
    maskElem.classList.add("border-success");
  }
};
const maskWrong = err => {
  isMaskError = true;
  if (!maskElem.classList.contains("border-danger")) {
    maskElem.classList.add("border-danger");
  }
  if (maskElem.classList.contains("border-success")) {
    maskElem.classList.remove("border-success");
  }
  if (err) {
    document.getElementById("subnet-bad").textContent = err;
  }
};

let isMaskError = true;
maskElem.addEventListener("input", async () => {
  const mask = maskElem.value;

  const checkedMask = await checkMask(mask);
  if (!checkedMask.isErr) {
    await getSubnet(hostsElem.value, maskElem.value, null);
    maskCorrect();
  } else maskWrong(checkedMask.err);
  hasTyped();
});

const slashCorrect = () => {
  isSlashError = false;
  if (slashElem.classList.contains("border-danger")) {
    slashElem.classList.remove("border-danger");
  }
  if (!slashElem.classList.contains("border-success")) {
    slashElem.classList.add("border-success");
  }
};

const slashWrong = () => {
  isSlashError = true;
  if (!slashElem.classList.contains("border-danger")) {
    slashElem.classList.add("border-danger");
  }
  if (slashElem.classList.contains("border-success")) {
    slashElem.classList.remove("border-success");
  }
};

let isSlashError = true;
slashElem.addEventListener("input", async () => {
  const n = Number.parseInt(slashElem.value);
  if (isNormalInteger(slashElem.value) && n >= 8 && n <= 30) {
    await getSubnet(hostsElem.value, null, slashElem.value);
    slashCorrect();
  } else slashWrong();
  hasTyped();
});

const getSubnet = async (hosts, mask, slash) => {
  if (currentController) {
    currentController.abort();
  }
  currentController = new AbortController();
  if (mask) {
    const { data } = await axios.get("/from-mask", {
      params: { mask, hosts },
      signal: currentController.signal
    });
    slashElem.value = data.slash;
    hostsElem.value = data.hosts;
  } else if (slash) {
    const { data } = await axios.get("/from-slash", {
      params: { slash, hosts },
      signal: currentController.signal
    });
    maskElem.value = data.mask;
    hostsElem.value = data.hosts;
  } else if (hosts) {
    const { data } = await axios.get("/from-hosts", {
      params: { hosts },
      signal: currentController.signal
    });
    maskElem.value = data.mask;
    slashElem.value = data.slash;
  }
  hostCorrect();
  maskCorrect();
  slashCorrect();
  hasTyped();
};

const setError = err => {
  document.getElementById("subnet-bad").textContent = err;

  document.getElementById("subnet-ok").style.display = "none";
  document.getElementById("subnet-bad").style.display = "block";
};

const hasTyped = async () => {
  if (isNetError) return setError("Please enter a valid IP address");
  if (isHostError) return setError("Please enter a valid host number");
  if (isMaskError) return setError("Please enter a valid subnet mask");
  if (isSlashError) return setError("Please enter a valid slash notation");

  return await getData();
};

const getData = async () => {
  try {
    if (currentController) {
      currentController.abort();
    }
    currentController = new AbortController();
    const { data } = await axios.post(
      "/",
      {
        ip: netElem.value,
        host: hostsElem.value
      },
      {
        signal: currentController.signal
      }
    );
    const {
      networkAddress,
      firstUsableHostAddress,
      lastUsableHostAddress,
      broadcastAddress,
      mask,
      slash,
      maxHosts
    } = data;

    document.getElementById(
      "ok-ip"
    ).innerHTML = `${networkAddress} <strong><small><i>/${slash}</i></small></strong>`;
    document.getElementById(
      "ok-hostrange"
    ).innerHTML = `${firstUsableHostAddress} &rarr; ${lastUsableHostAddress}`;
    document.getElementById("ok-hostnumber").innerHTML = `${new Intl.NumberFormat("it-IT").format(
      maxHosts
    )} hosts`;
    document.getElementById("ok-broadcast").innerHTML = `${broadcastAddress}`;
    document.getElementById("ok-mask").innerHTML = `${mask}`;

    document.getElementById("subnet-ok").style.display = "block";
    document.getElementById("subnet-bad").style.display = "none";
  } catch (err) {
    document.getElementById("subnet-ok").style.display = "none";
    document.getElementById("subnet-bad").style.display = "block";
    document.getElementById("subnet-bad").textContent = err.response?.data || err;
    throw err;
  }
};
