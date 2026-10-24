/* =====================================================
   HYLOOKS v1.1 FINAL PRODUCTION
   MP4 URL Encoder / Decoder
   MASTER LOCKED
===================================================== */

const HYLOOKS_VERSION = 1;

/* ================= CREATE IV ================= */

function createIV(videoId){

    const seed =
        Math.random()
            .toString(36)
            .substring(2,8)
            .toUpperCase();

    return `HYL${videoId.replace("video","")}${seed}`;

}

/* ================= VALIDATE DIRECT MP4 URL ================= */

function validateVidey(url){

    try{

        const u = new URL(url);

        // Wajib HTTPS
        if(u.protocol !== "https:") return false;

        // Wajib file MP4
        return u.pathname.toLowerCase().endsWith(".mp4");

    }catch{

        return false;

    }

}

/* ================= ENCODE ================= */

function encodeVidey(url, videoId){

    if(!validateVidey(url)){
        throw new Error("URL tidak valid. Gunakan URL HTTPS langsung yang path-nya berakhiran .mp4.");
    }

    const iv = createIV(videoId);

    let xor = "";

    for(let i=0;i<url.length;i++){

        xor += String.fromCharCode(
            url.charCodeAt(i) ^
            iv.charCodeAt(i % iv.length)
        );

    }

    xor = xor.split("").reverse().join("");

    return {

        provider:"videy", // kompatibilitas dengan Worker saat ini

        encrypted:btoa(xor),

        iv,

        ver:HYLOOKS_VERSION

    };

}

/* ================= DECODE ================= */

function decodeVidey(video){

    if(!video) return "";

    let data = atob(video.encrypted);

    data = data.split("").reverse().join("");

    let output = "";

    const key = video.iv;

    for(let i=0;i<data.length;i++){

        output += String.fromCharCode(
            data.charCodeAt(i) ^
            key.charCodeAt(i % key.length)
        );

    }

    return output;

}

/* ================= EXPORT ================= */

window.HyLooksEncoder = {

    encodeVidey,

    decodeVidey,

    validateVidey

};