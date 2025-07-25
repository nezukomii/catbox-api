// api/index.js - Catbox.moe Scraper API for Cloudflare Workers

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json'
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Router
    try {
      switch (url.pathname) {
        case '/':
          return handleRoot(corsHeaders);
        
        case '/health':
          return handleHealth(corsHeaders);
        
        case '/upload':
          return handleUpload(request, corsHeaders);
        
        case '/upload/temp':
          return handleUploadTemp(request, corsHeaders);
        
        case '/upload/url':
          return handleUploadFromUrl(request, corsHeaders);
        
        default:
          return new Response(
            JSON.stringify({ error: 'Not found' }), 
            { status: 404, headers: corsHeaders }
          );
      }
    } catch (error) {
      return new Response(
        JSON.stringify({ 
          error: 'Internal server error', 
          message: error.message 
        }), 
        { status: 500, headers: corsHeaders }
      );
    }
  }
};

// Handlers
function handleRoot(headers) {
  return new Response(JSON.stringify({
    message: "Catbox Uploader API - Cloudflare Workers Edition",
    endpoints: {
      "/upload": "Upload file to catbox.moe (permanent)",
      "/upload/temp": "Upload file to litterbox (temporary)",
      "/upload/url": "Upload file from URL",
      "/health": "Check API status"
    },
    limits: {
      max_file_size: "200MB",
      allowed_methods: ["POST"],
      temp_durations: ["1h", "12h", "24h", "72h"]
    }
  }), { headers });
}

function handleHealth(headers) {
  return new Response(JSON.stringify({
    status: "ok",
    service: "catbox-uploader-worker",
    timestamp: new Date().toISOString()
  }), { headers });
}

async function handleUpload(request, headers) {
  if (request.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }), 
      { status: 405, headers }
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file');
    
    if (!file) {
      return new Response(
        JSON.stringify({ error: 'No file provided' }), 
        { status: 400, headers }
      );
    }

    // Check file size (200MB limit)
    const fileSize = file.size;
    const fileSizeMB = fileSize / (1024 * 1024);
    
    if (fileSizeMB > 200) {
      return new Response(
        JSON.stringify({ 
          error: 'File too large', 
          max_size: '200MB',
          file_size: `${fileSizeMB.toFixed(2)}MB`
        }), 
        { status: 413, headers }
      );
    }

    // Upload to catbox
    const uploadFormData = new FormData();
    uploadFormData.append('reqtype', 'fileupload');
    uploadFormData.append('fileToUpload', file);

    const response = await fetch('https://catbox.moe/user/api.php', {
      method: 'POST',
      body: uploadFormData
    });

    if (!response.ok) {
      throw new Error(`Upload failed with status ${response.status}`);
    }

    const result = await response.text();
    
    // Catbox returns the URL directly
    if (result.startsWith('https://')) {
      return new Response(JSON.stringify({
        success: true,
        url: result.trim(),
        filename: file.name,
        size_mb: parseFloat(fileSizeMB.toFixed(2))
      }), { headers });
    } else {
      throw new Error('Invalid response from catbox');
    }

  } catch (error) {
    return new Response(
      JSON.stringify({ 
        success: false,
        error: 'Upload failed', 
        message: error.message 
      }), 
      { status: 500, headers }
    );
  }
}

async function handleUploadTemp(request, headers) {
  if (request.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }), 
      { status: 405, headers }
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const time = formData.get('time') || '1h';
    
    if (!file) {
      return new Response(
        JSON.stringify({ error: 'No file provided' }), 
        { status: 400, headers }
      );
    }

    // Validate time parameter
    const validTimes = ['1h', '12h', '24h', '72h'];
    if (!validTimes.includes(time)) {
      return new Response(
        JSON.stringify({ 
          error: 'Invalid time parameter',
          valid_times: validTimes,
          provided: time
        }), 
        { status: 400, headers }
      );
    }

    // Check file size
    const fileSize = file.size;
    const fileSizeMB = fileSize / (1024 * 1024);
    
    if (fileSizeMB > 200) {
      return new Response(
        JSON.stringify({ 
          error: 'File too large', 
          max_size: '200MB',
          file_size: `${fileSizeMB.toFixed(2)}MB`
        }), 
        { status: 413, headers }
      );
    }

    // Upload to litterbox
    const uploadFormData = new FormData();
    uploadFormData.append('reqtype', 'fileupload');
    uploadFormData.append('time', time);
    uploadFormData.append('fileToUpload', file);

    const response = await fetch('https://litterbox.catbox.moe/resources/internals/api.php', {
      method: 'POST',
      body: uploadFormData
    });

    if (!response.ok) {
      throw new Error(`Upload failed with status ${response.status}`);
    }

    const result = await response.text();
    
    if (result.startsWith('https://')) {
      return new Response(JSON.stringify({
        success: true,
        url: result.trim(),
        filename: file.name,
        size_mb: parseFloat(fileSizeMB.toFixed(2)),
        expiration: time,
        temporary: true
      }), { headers });
    } else {
      throw new Error('Invalid response from litterbox');
    }

  } catch (error) {
    return new Response(
      JSON.stringify({ 
        success: false,
        error: 'Upload failed', 
        message: error.message 
      }), 
      { status: 500, headers }
    );
  }
}

async function handleUploadFromUrl(request, headers) {
  if (request.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }), 
      { status: 405, headers }
    );
  }

  try {
    const body = await request.json();
    const { url, temporary = false, time = '1h' } = body;
    
    if (!url) {
      return new Response(
        JSON.stringify({ error: 'No URL provided' }), 
        { status: 400, headers }
      );
    }

    // Validate URL
    try {
      new URL(url);
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid URL' }), 
        { status: 400, headers }
      );
    }

    // Download file from URL
    const fileResponse = await fetch(url);
    
    if (!fileResponse.ok) {
      return new Response(
        JSON.stringify({ 
          error: 'Failed to download file',
          status: fileResponse.status
        }), 
        { status: 400, headers }
      );
    }

    // Get file data
    const blob = await fileResponse.blob();
    const contentType = fileResponse.headers.get('content-type') || 'application/octet-stream';
    
    // Extract filename from URL or use default
    const urlPath = new URL(url).pathname;
    const filename = urlPath.split('/').pop() || 'download';
    
    // Check file size
    const fileSizeMB = blob.size / (1024 * 1024);
    
    if (fileSizeMB > 200) {
      return new Response(
        JSON.stringify({ 
          error: 'File too large', 
          max_size: '200MB',
          file_size: `${fileSizeMB.toFixed(2)}MB`
        }), 
        { status: 413, headers }
      );
    }

    // Create form data
    const uploadFormData = new FormData();
    uploadFormData.append('reqtype', 'fileupload');
    
    if (temporary) {
      uploadFormData.append('time', time);
    }
    
    const file = new File([blob], filename, { type: contentType });
    uploadFormData.append('fileToUpload', file);

    // Upload to catbox/litterbox
    const uploadUrl = temporary 
      ? 'https://litterbox.catbox.moe/resources/internals/api.php'
      : 'https://catbox.moe/user/api.php';
    
    const response = await fetch(uploadUrl, {
      method: 'POST',
      body: uploadFormData
    });

    if (!response.ok) {
      throw new Error(`Upload failed with status ${response.status}`);
    }

    const result = await response.text();
    
    if (result.startsWith('https://')) {
      const responseData = {
        success: true,
        url: result.trim(),
        original_url: url,
        filename: filename,
        size_mb: parseFloat(fileSizeMB.toFixed(2))
      };
      
      if (temporary) {
        responseData.expiration = time;
        responseData.temporary = true;
      }
      
      return new Response(JSON.stringify(responseData), { headers });
    } else {
      throw new Error('Invalid response from catbox');
    }

  } catch (error) {
    return new Response(
      JSON.stringify({ 
        success: false,
        error: 'Upload failed', 
        message: error.message 
      }), 
      { status: 500, headers }
    );
  }
      }
