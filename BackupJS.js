const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');


class DynamicEnum {
    constructor(command, enumName, initialValues = []) {
        this.command = command;
        this.enumName = enumName;
        this.values = new Set(initialValues);
        
        // 初始化 SoftEnum
        this.command.setSoftEnum(this.enumName, Array.from(this.values));
    }

    addValue(value) {
        if (!this.values.has(value)) {
            this.values.add(value);
            this.command.addSoftEnumValues(this.enumName, [value]);
        }
    }

    addValues(values) {
        values.forEach(value => this.addValue(value));
    }

    removeValue(value) {
        if (this.values.has(value)) {
            this.values.delete(value);
            this.command.removeSoftEnumValues(this.enumName, [value]);
        }
    }

    listValues() {
        return Array.from(this.values);
    }

    contains(value) {
        return this.values.has(value);
    }

    getEnumName() {
        return this.enumName;
    }
}


ll.registerPlugin(
    "BackupJS",
    "A plugin to manage backups",
    [0, 0, 7],
    {}
);

const pluginName = "BackupJS";
const backup_tmp = "./backup_tmp";
const worldName = /level-name=(.*)/.exec(File.readFrom('./server.properties'))[1];

// 提前获取语言和成功消息，并打印到日志中进行调试
const lang = getLangFromProperties();
logger.info(`读取到的语言配置: ${lang}`)

const successMessage = getSuccessMessage(lang);
logger.info(`读取到的成功消息: ${successMessage}`)


const configPath = "plugins/BackupJS/config.json";

var defaultConfig = {
    Language: "zh_CN",
    MaxStorageTime: 7,
    BackupPath: "./backup", 
    PermanentBackupPath: "./backup/permanent_backup",
    queryRetries: 10,     // 尝试次数
    retryDelay: 100,      // 每次重试之间的延迟（毫秒）根据加载区块计算
    initialDelay: 50,     // 在第一次查询前的延迟（毫秒）根据加载区块计算
    format: "zip",
    Compress: 0,
    MaxWaitForZip: 1800,
    "7za": "./plugins/BackupJS",
    RecoveryBackupCore: "./plugins/BackupJS",
    serverExe: "bedrock_server_mod.exe",
    upload: {
        remotePath: '/backup',  // 如果文件上传失败: 403 Forbidden （用户名和密码是正确）可能是没有webdav创建文件夹失败导致的
        webdavUrl: 'https://xxx.com/webdav',
        username: '123',
        password: '114514',
        allowInsecure: false   // 是否允许不安全的 HTTPS 连接（忽略证书验证）
    },
    allowlist: ["114514"],
    Serein:{
    enabled: false,
    id:"myserver",
    host:"http://127.0.0.1:61545",
    auth:"abcd",
    pmid:"",
    gmid:"",
	msg: {
		Processing:"正在回档",
		Success:"回档成功"
        }
    }
};

function deepMerge(target, source) {
    for (const key in source) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
            if (!target[key] || typeof target[key] !== 'object') {
                target[key] = {};
            }
            deepMerge(target[key], source[key]);
        } else {
            target[key] = source[key];
        }
    }
    return target;
}

function readConfig() {
    let currentConfig = {};

    // 检查配置文件是否存在
    if (fs.existsSync(configPath)) {
        // 读取现有配置文件
        try {
            const data = fs.readFileSync(configPath, 'utf8');
            currentConfig = JSON.parse(data);
        } catch (error) {
            sendMessage(null, `Failed to read or parse config: ${error}`, 'error');
            currentConfig = {};
        }
    } else {
        sendMessage(null, `Config file not found, creating default config at ${configPath}`, 'info');
    }

    //合并默认配置与现有配置
    const mergedConfig = deepMerge(defaultConfig, currentConfig);

    // 检查是否有新的配置项需要写回文件
    const isConfigUpdated = JSON.stringify(mergedConfig) !== JSON.stringify(currentConfig);
    if (isConfigUpdated) {
        try {
            fs.writeFileSync(configPath, JSON.stringify(mergedConfig, null, 4), 'utf8');
            sendMessage(null, `Config file updated with missing keys at ${configPath}`, 'info');
        } catch (error) {
            sendMessage(null, `Failed to update config file: ${error}`, 'error');
        }
    }

    return mergedConfig;
}

const config = readConfig();

function resettmp() {
    if (fs.existsSync(backup_tmp)) {
        fs.rmSync(backup_tmp, { recursive: true, force: true });
    }
    fs.mkdirSync(backup_tmp, { recursive: true });
}

 
function initializeBackupPaths() {
    // 确保临时备份路径存在并清理旧的临时文件
	resettmp();

    // 确保普通备份路径和永久备份路径存在
    const backupDirs = [config.BackupPath, config.PermanentBackupPath];
    backupDirs.forEach(dir => {
        const fullPath = path.resolve(dir);
        if (!fs.existsSync(fullPath)) {
            fs.mkdirSync(fullPath, { recursive: true });
        }
    });
}

// 初始化
function init() {
    initializeBackupPaths();
}

function sendMessage(player, message, type) {
    if (player) {
        player.tell(`[${pluginName}] ${message}`, 0);
    } else {
        switch (type) {
            case 'error': logger.error(message); break;
            case 'warn': logger.warn(message); break;
            case 'debug': logger.debug(message); break;
            default: logger.info(message); break;
        }
    }
}

function kickAllPlayers(message = `服务器回档中`) {
    mc.getOnlinePlayers().forEach(player => player.kick(message));
}

function copyFolder(source, target, deleteAfterCopy = false, callback) {
    const exePath = path.resolve(config.RecoveryBackupCore, 'Recovery_Backup_Core.exe'); // Rust 程序路径
    
    let command = `"${exePath}" copy "${source}" "${target}"`;

    if (deleteAfterCopy) {
        command += " --delete";
    }
    exec(command, (error, stdout, stderr) => {
        if (error) {
            sendMessage(null, `exec error: ${error}`, 'error');
            callback(false);
            return;
        }
        callback(true);
    });
}

function cleanupOldBackups(BackupPath, maxAgeDays, callback) {
    const exePath = path.join(config.RecoveryBackupCore, 'Recovery_Backup_Core.exe'); // Rust 程序路径
    const format = config.format;
    // 构建执行命令
    const command = `"${exePath}" cleanup "${BackupPath}" "${maxAgeDays}" "${format}"`;

    // 执行命令
    exec(command, (error, stdout, stderr) => {
        if (error) {
            sendMessage(null, `exec error: ${error.message}`, 'error');
            callback(false);
            return;
        }
        callback(true);
    });
}


function formatSize(bytes) {
    if (bytes >= 1024 ** 3) {
        return (bytes / (1024 ** 3)).toFixed(2) + ' GB';
    } else if (bytes >= 1024 ** 2) {
        return (bytes / (1024 ** 2)).toFixed(2) + ' MB';
    } else if (bytes >= 1024) {
        return (bytes / 1024).toFixed(2) + ' KB';
    } else {
        return bytes + ' bytes';
    }
}

function formatDuration(ms) {
    if (ms >= 1000 * 60) {
        return (ms / (1000 * 60)).toFixed(2) + 'min';
    } else if (ms >= 1000) {
        return (ms / 1000).toFixed(2) + 's';
    } else {
        return ms + ' ms';
    }
}

function compressFolder(source, target, callback) {
    const exePath = path.join(config["7za"], '7za.exe');
    const compressLevel = config.Compress;
    const maxWaitForZip = config.MaxWaitForZip;
    const format = config.format;

    // 检查7za.exe路径是否存在
    if (!fs.existsSync(exePath)) {
        sendMessage(null, `7za.exe not found at path: ${exePath}`, 'error');
        callback(false, 0);
        return;
    }

    // 根据格式选择相应的命令选项
    let formatOption;
    switch (format.toLowerCase()) {
        case 'zip':
            formatOption = '-tzip';
            break;
        case '7z':
            formatOption = '-t7z';
            break;
        case 'tar':
            formatOption = '-ttar';
            break;
        case 'gzip':
            formatOption = '-tgzip';
            break;
        case 'bzip2':
            formatOption = '-tbzip2';
            break;
        case 'xz':
            formatOption = '-txz';
            break;
        default:
            sendMessage(null, `不支持的压缩格式: ${format}`, 'error');
            callback(false, 0);
            return;
    }

    target = `${target}.${format}`;
    
    const command = `"${exePath}" a ${formatOption} -mx=${compressLevel} "${target}" "${source}\\*"`; // 使用通配符
    //console.log(`Running command: ${command}`);


    // 执行压缩命令
    const compressProcess = exec(command, (error, stdout, stderr) => {
        clearTimeout(timeout);
        if (error) {
            sendMessage(null, `exec error: ${error.message}`, 'error');
            callback(false, 0);
            return;
        }
        // 获取压缩文件的大小
        fs.stat(target, (err, stats) => {
            if (err) {
                sendMessage(null, `Failed to get file size: ${err.message}`, 'error');
                callback(false, 0);
            } else {
                callback(true, stats.size);
            }
        });
    });

    // 设置超时处理
    const timeout = setTimeout(() => {
        compressProcess.kill();
        sendMessage(null, `压缩超时 (${maxWaitForZip} s)`, 'error');
        callback(false, 0);
    }, maxWaitForZip * 1000);
}

function getExtensionByFormat(format) {
    switch (format) {
        case 'zip':
            return '.zip';
        case '7z':
            return '.7z';
        case 'tar':
            return '.tar';
        case 'gzip':
            return '.gz';
        case 'bzip2':
            return '.bz2';
        case 'xz':
            return '.xz';
        default:
            return '.zip'; // 默认使用 .zip 作为扩展名
    }
}

function copydb(source, target, db, callback) {
    const exePath = path.resolve(config.RecoveryBackupCore, 'Recovery_Backup_Core.exe'); // Rust 程序路径

    const tempDbFile = path.resolve(backup_tmp, 'db_list.txt');
    fs.writeFileSync(tempDbFile, db + '\n', 'utf8'); 

    // 将 db 列表的文件路径传递给命令行
    let command = `"${exePath}" copy_db "${source}" "${target}" "${tempDbFile}"`;
    //console.log(`${command}`);
    
    exec(command, (error, stdout, stderr) => {
        if (error) {
            sendMessage(null, `exec error: ${error}`, 'error');
            callback(false);
            return;
        }
        callback(true);
    });
}


let isBackupInProgress = false;

function backup(player, output, isPermanent = false) {
    if (isBackupInProgress) {
        sendMessage(player, "备份正在进行中，请稍后再试。", 'warn');
        return;
    }
    isBackupInProgress = true;
    const startTime = new Date();
    const timestamp = system.getTimeStr().replace(/ /, '_').replace(/:/g, '-');
    const worldPath = `./worlds/${worldName}`;
    const BackupDir = isPermanent ? config.PermanentBackupPath : config.BackupPath;
    const zipFileName = path.resolve(BackupDir, `${worldName}_${timestamp}`);
    const maxAgeDays = config.MaxStorageTime;
    const retries = config.queryRetries;
    const delayBetweenRetries = config.retryDelay;
    const delayBeforeFirstQuery = config.initialDelay;

    if (!fs.existsSync(config.BackupPath)) {
        fs.mkdirSync(config.BackupPath);
    }
    sendMessage(player, "开始执行备份...", 'info');

	if (isPermanent) {
	} else if (maxAgeDays !== -1) {
		// 如果 maxAgeDays 有效且不是永久备份，执行旧备份清理
		cleanupOldBackups(config.BackupPath, maxAgeDays, (cleanupResult) => {
			if (cleanupResult) {
				sendMessage(player, "旧备份清理完成", 'info');
			} else {
				sendMessage(player, "清理失败", 'error');
			}
		});
	} else {
		sendMessage(player, "跳过旧备份清理", 'info');
	}


    const holdResult = mc.runcmdEx("save hold");
    if (!holdResult.success) {
        mc.runcmdEx("save resume");
        sendMessage(player, "尝试暂停世界存储时发生错误，备份中止。", 'error');
        isBackupInProgress = false;
        return;
    }

    function tryQuerySaveState(attempt) {
        if (attempt > retries) {
            mc.runcmdEx("save resume");
            sendMessage(player, "多次尝试查询保存状态失败，放弃备份。", 'error');
            isBackupInProgress = false;
            return;
        }

        const queryResult = mc.runcmdEx("save query");
		const successPattern = new RegExp(`^${successMessage}.*`);
        if (queryResult.success && successPattern.test(queryResult.output)) {
         const db = queryResult.output.replace(successPattern, '').trim();
			//console.log(`DB 文件信息: ${db}`);  // 记录日志
            sendMessage(player, "数据已保存，可以开始复制。", 'info');

            copydb(worldPath, backup_tmp, db, (result) => {
                if (result) {
					mc.runcmdEx("save resume");
                    sendMessage(player, "数据复制完成。", 'info');

                    compressFolder(backup_tmp, zipFileName, (compressResult, fileSize) => {
                        const endTime = new Date();
                        const duration = endTime - startTime;

                        if (compressResult) {
                            const formattedSize = formatSize(fileSize);
                            const formattedDuration = formatDuration(duration);
                            sendMessage(player, `备份完成，总耗时 ${formattedDuration}，文件大小 ${formattedSize}`, 'info');
                            resettmp();
                        } else {
                            sendMessage(player, "压缩失败", 'error');
                        }

                        isBackupInProgress = false;
                    });
                } else {
                    sendMessage(player, "数据复制失败。", 'error');
                    isBackupInProgress = false;
                }
            });
        } else {
            sendMessage(player, `查询保存状态失败或返回结果不匹配，重试第 ${attempt} 次。`, 'error');
            setTimeout(() => tryQuerySaveState(attempt + 1), delayBetweenRetries);
        }
    }

    setTimeout(() => tryQuerySaveState(1), delayBeforeFirstQuery);
}

function getLangFromProperties() {
    const serverPropertiesPath = path.resolve('./server.properties');
    let lang = 'en_US'; // 默认语言

    try {
        const propertiesContent = fs.readFileSync(serverPropertiesPath, 'utf8');
        // 逐行处理内容，忽略以 # 开头的注释行
        const lines = propertiesContent.split('\n');
        for (const line of lines) {
            const trimmedLine = line.trim();
            // 忽略注释行
            if (trimmedLine.startsWith('#')) {
                continue;
            }
            const match = /language\s*=\s*(.*)/.exec(trimmedLine);
            if (match) {
                lang = match[1].trim(); // 去掉前后空白
                break; // 找到语言设置后可以退出循环
            }
        }
    } catch (err) {
        console.error(`Error reading server.properties: ${err.message}`);
    }

    return lang;
}

function getSuccessMessage(lang) {
    const langFilePath = path.resolve(`./resource_packs/vanilla/texts/${lang}.lang`);

    try {
        const langFileContent = fs.readFileSync(langFilePath, 'utf8');

        // 匹配成功消息，并保留末尾的句号
        const match = /commands\.save-all\.success\s*=\s*(.*?)(?=\s*(#|$))/.exec(langFileContent);

        if (match) {
            let message = match[1].trim();
            
            // 保留最后的句号并去掉之后的空白
            message = message.replace(/\s*[。.]?\s*$/, match => match.trim());
            return message;
        }

        // 如果未匹配到，则返回默认英文消息
        return 'Data saved. Files are now ready to be copied.';
    } catch (err) {
        console.error(`Error reading language file (${langFilePath}): ${err.message}`);
        return 'Data saved. Files are now ready to be copied.'; // 默认值
    }
}





function recoverBackup(player, output, backupFilename,isPermanent = false) {
    const BackupDir = isPermanent ? config.PermanentBackupPath : config.BackupPath;
    const BackupPath = path.resolve(BackupDir); // 转换为绝对路径
    const sanitizedBackupFilename = backupFilename.replace(/["']/g, ""); // 使用正则表达式移除引号
    const backupFilePath = path.resolve(BackupPath, sanitizedBackupFilename); // 转换为绝对路径
    const serverExe = config.serverExe;
    const serverDir = path.resolve("."); // 服务器目录路径
    const sevenZipPath = path.resolve(config["7za"], '7za.exe'); // 7za 的路径
    let url = '';
    let auth = '';
	if (config.Serein.enabled) {                     
		auth = config.Serein.auth;
		id = config.Serein.id;
		pmid = config.Serein.pmid || ''; // 从配置中获取 pmid，默认值为空字符串
		gmid = config.Serein.gmid || ''; // 从配置中获取 gmid，默认值为空字符串
		msg = config.Serein.msg || {};   // 从配置中获取 msg，默认值为空字符串
		url = `${config.Serein.host}/serein/{}?id=${id}`;
		// 动态添加可选参数
		if (pmid) {
			url += `&pmid=${pmid}`;
		}
		if (gmid) {
			url += `&gmid=${gmid}`;
		}
	if (msg && msg.Processing && msg.Success) {
		const encodedProcessing = Buffer.from(msg.Processing, 'utf-8').toString('base64');
		const encodedSuccess = Buffer.from(msg.Success, 'utf-8').toString('base64');
		
        url += `&msg=${encodedProcessing}`;
        url += `&msg=${encodedSuccess}`;
		}
		
	if (!url || !auth || !id) {
		sendMessage(player, "配置错误：url 或 auth 或 id 参数不能为空！", 'error');
		return;
		}
	
	}
	
    // 将路径转换为 Base64 编码 绕过中文路径
    const base64BackupFilePath = Buffer.from(backupFilePath).toString('base64');

	const exePath = path.resolve(config.RecoveryBackupCore, 'Recovery_Backup_Core.exe');

    // 检查备份文件是否存在
    if (!fs.existsSync(backupFilePath)) {
        sendMessage(player, `备份文件不存在: ${backupFilePath}`, 'error');
        return;
    }

    // 检查 Recovery_Backup_Core.exe 是否存在
    if (!fs.existsSync(exePath)) {
        sendMessage(player, `恢复程序不存在: ${exePath}`, 'error');
        return;
    }

const batchContent = `
@echo off
"${exePath}" recover "${base64BackupFilePath}" "${serverDir}" "${worldName}" "${serverExe}" "${sevenZipPath}"${url ? ` "${url}"` : ''}${auth ? ` "${auth}"` : ''}`;


	// 使用 UTF-8 编码写入批处理文件
	const batchFilePath = path.resolve(__dirname, 'startup_script.bat');
	fs.writeFileSync(batchFilePath, batchContent, { encoding: 'utf8' });

    // 使用 PowerShell 启动批处理文件
    const command = `powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process cmd -ArgumentList '/c \"${batchFilePath}\"' "`;
    console.log(`启动恢复程序: ${command}`); // 输出命令以供调试

    exec(command, (error, stdout, stderr) => {
    });
	kickAllPlayers();
	 if (!config.Serein.enabled) {
		mc.runcmdEx("stop");
	}

}

// 列出备份文件功能
function listBackups(player, output, isPermanent = false) {
    getAllBackupFilenames(isPermanent)
        .then(backupFiles => {
            if (backupFiles.length === 0) {
                sendMessage(player, '没有找到任何备份文件。', 'info');
            } else {
                sendMessage(player, '找到以下备份文件:', 'info');
                backupFiles.forEach(file => sendMessage(player, file, 'info'));
            }
        })
        .catch(error => {
            sendMessage(player, error, 'error');
        });
}

function uploadBackup(player, output, backupName, isPermanent = false) {
    const exePath = path.join(config.RecoveryBackupCore, 'Recovery_Backup_Core.exe');
    const BackupDir = isPermanent ? config.PermanentBackupPath : config.BackupPath;
    const BackupPath = path.resolve(BackupDir); // 转换为绝对路径
    const sanitizedBackupName = backupName.replace(/['"]/g, ''); // 移除不必要的引号
    const backupFilePath = path.resolve(BackupPath, sanitizedBackupName); // 转换为绝对路径
    const remotePath = config.upload.remotePath;
    const webdavUrl = config.upload.webdavUrl;
    const username = config.upload.username;
    const password = config.upload.password;
    const allowInsecure = config.upload.allowInsecure ? 'true' : 'false'; // 转换为字符串 'true' 或 'false'
    
    // 检查备份文件是否存在
    if (!fs.existsSync(backupFilePath)) {
        sendMessage(player, `备份文件未找到: ${backupFilePath}`, 'error');
        return;
    }

    // 构建命令
    const command = `"${exePath}" upload "${backupFilePath}" "${remotePath}" "${webdavUrl}" "${username}" "${password}" ${allowInsecure}`;

    //console.log(`${command}`);
    // 执行上传命令
     sendMessage(player, "正在上传中...", 'info');
    exec(command, (error, stdout, stderr) => {
        if (error) {
            sendMessage(player, `上传时出错: ${error.message}`, 'error');
            return;
        }

        if (stderr) {
            sendMessage(player, `上传警告: ${stderr}`, 'warning');
            return;
        }
        const cleanedOutput = stdout
		  // 去除日期时间戳和 [INFO] 部分
		  .replace(/\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] \[INFO\] /g, '')
		  // 去除 ANSI 颜色控制符
		  .replace(/\x1b\[[0-9;]*m/g, '')
		  .trim();

        sendMessage(player, `上传成功: ${cleanedOutput}`, 'info');
    });
}



// 删除备份文件功能
function removeBackup(player, output, filename, isPermanent = false, isFromGUI = false) {
    // 根据 isPermanent 判断使用哪个路径
    const BackupPath = path.join(isPermanent ? config.PermanentBackupPath : config.BackupPath, filename);
    if (!fs.existsSync(BackupPath)) {
        sendMessage(player, `找到名为 "${backupName}" 的备份文件，操作已取消。`, 'error');
        return; // 直接退出函数，不做任何操作
		}
    fs.unlink(BackupPath, (err) => {
        if (err) {
            sendMessage(player, `删除备份失败: ${err}`, 'error');
            return;
        }

        sendMessage(player, `备份 ${filename} 已成功删除`, 'info');

        if (isFromGUI) {
            // 根据 isPermanent 判断重新显示哪个备份列表
            if (isPermanent) {
                listPermanentBackupsGUI(player, output);
            } else {
                listBackupsGUI(player, output);
            }
        }
    });
}





function isValidFilename(filename) {
    // Windows 不允许使用的字符
    const invalidCharsPattern = /[\/\\:*?"<>|]/;

    // Windows 不允许的文件名（设备名称）
    const reservedNamesPattern = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

    // 检查文件名是否包含不允许的字符，并且不是保留名称
    return !invalidCharsPattern.test(filename) && !reservedNamesPattern.test(filename);
}



function renameBackup(player, output, filename, newname, isGUI = false ,isPermanent) {

	// 移除可能的引号
	let sanitizedFilename = filename.replace(/"/g, '');
	let sanitizedNewname = newname.replace(/"/g, '');
	
	    // 检查文件名是否只包含有效字符
    if (!isValidFilename(sanitizedFilename) || !isValidFilename(sanitizedNewname)) {
        sendMessage(player, '重命名失败: 文件名只能包含英文字符、数字和部分符号。', 'error');
        if (isGUI) {
            player.sendModalForm(
                "重命名失败",
                '文件名只能包含英文字符、数字和部分符号。',
                "重新命名",
                "取消",
                (player, result) => {
                    if (result) {
                        renameBackupGUI(player, output, filename,isPermanent); // 重新显示表单
                    } 
                }
            );
        }
        return;
    }

	const extension = getExtensionByFormat(config.format);

	// 如果文件名不以相应的扩展名结尾，则添加该扩展名
	if (!sanitizedFilename.endsWith(extension)) {
		sanitizedFilename += extension;
	}
	if (!sanitizedNewname.endsWith(extension)) {
		sanitizedNewname += extension;
	}

    const BackupDir = isPermanent ? config.PermanentBackupPath : config.BackupPath;
    const BackupPath = path.resolve(BackupDir); // 转换为绝对路径
    
    const FilenamePath = path.join(BackupPath, sanitizedFilename);
    const NewnamePath = path.join(BackupPath, sanitizedNewname);

    if (fs.existsSync(NewnamePath)) {
        sendMessage(player, `重命名失败: 备份名称 ${sanitizedNewname} 已经存在，请选择其他名称。`, 'error');
        if (isGUI) {
            player.sendModalForm(
                "重命名失败",
                `备份名称 ${sanitizedNewname} 已经存在，请选择其他名称。`,
                "重新命名",
                "取消",
                (player, result) => {
                    if (result) {
                        renameBackupGUI(player, output, filename); // 重新显示表单
                    } 
                }
            );
        }
        return;
    }

    fs.rename(FilenamePath, NewnamePath, (err) => {
        if (err) {
            sendMessage(player, `重命名失败: ${err}`, 'error');
            return;
        }
        sendMessage(player, `备份 ${sanitizedFilename} 已重命名为 ${sanitizedNewname}`, 'info');

        if (isGUI && isPermanent) {
            listPermanentBackupsGUI(player, output); 
        }else if  (isGUI && !isPermanent){
			listBackupsGUI(player, output); 
        }
    });
}


function renameBackupGUI(player, output, backupName,isPermanent) {
	const extension = getExtensionByFormat(config.format);
    const fm = mc.newCustomForm();
    fm.setTitle("重命名备份");
    fm.addInput("新备份名称", "请输入新的备份名称", backupName.replace(extension, ''));

    player.sendForm(fm, (player, data) => {

        if (!Array.isArray(data)) {
            return;
        }

        if (data.length < 1 || typeof data[0] !== 'string') {
            sendMessage(player, "表单已取消或数据不完整", 'info');
            return;
        }
        const newName = data[0].trim();

        if (newName === "") {
            player.sendModalForm(
                "重命名失败",
                "名称无效，请输入有效的备份名称。",
                "重新命名", 
                "取消",
                (player, result) => {
                    if (result) {
                        renameBackupGUI(player, output, backupName,isPermanent); // 重新显示表单
                    } 
                }
            );
            return;
        }

        renameBackup(player, output, backupName, `${newName}${extension}`, true, isPermanent);
    });
}

function confirmTransferBackup(player, output, backupName, isPermanent = false, isFromGUI = false, remove = false) {
    const sourcePath = path.resolve(isPermanent ? config.PermanentBackupPath : config.BackupPath, backupName);
    const targetPath = path.resolve(isPermanent ? config.BackupPath : config.PermanentBackupPath, backupName);
    
        // 检查源路径是否存在
    if (!fs.existsSync(sourcePath)) {
        sendMessage(player, `源路径中没有找到名为 "${backupName}" 的备份文件，操作已取消。`, 'error');
        return; // 直接退出函数，不做任何操作
    }

    // 检查目标路径是否存在同名文件夹
    if (fs.existsSync(targetPath)) {
        sendMessage(player, `目标路径中已存在名为 "${backupName}" 的备份文件，操作已取消。`, 'error');
        return; // 直接退出函数，不做任何操作
    }

    if (isFromGUI) {
        const fm = mc.newSimpleForm();
        fm.setTitle("移动备份操作确认");
        fm.setContent(`您确定要${isPermanent ? '移动到普通备份' : '添加到永久备份'}吗？\n请选择一个选项：`);
        fm.addButton("保留原备份");
        fm.addButton("复制并删除原备份");

        // 发送表单并处理用户选择
        player.sendForm(fm, (player, id) => {
            if (id === null || id === undefined) {
                return;
            }

            const deleteAfterCopy = id === 1; // 如果用户选择"移动并删除原备份"，则删除原备份

            // 调用 copyFolder 函数执行复制操作
            handleBackupTransfer(player, output, backupName, sourcePath, targetPath, deleteAfterCopy, isPermanent,isFromGUI);
        });
    } else {
        // 不使用 GUI，直接执行默认的备份转移逻辑
        const deleteAfterCopy = remove; // 使用传入的 remove 参数决定是否删除原备份

        // 调用 copyFolder 函数执行复制操作
        handleBackupTransfer(player, output, backupName, sourcePath, targetPath, deleteAfterCopy, isPermanent,isFromGUI);
    }
}

function handleBackupTransfer(player, output, backupName, sourcePath, targetPath, deleteAfterCopy, isPermanent,isFromGUI) {
    copyFolder(sourcePath, targetPath, deleteAfterCopy, (success) => {
        if (success) {
            sendMessage(player, `备份 ${backupName} 已成功${isPermanent ? '复制到普通备份' : '添加到永久备份'}${deleteAfterCopy ? '，并删除了原备份' : ''}`, 'info');
        } else {
            sendMessage(player, `备份 ${backupName} ${isPermanent ? '复制到普通备份' : '添加到永久备份'} 失败`, 'error');
        }
	if (isFromGUI) {
        showBackupOptions(player, output, backupName, !isPermanent);
        }
    });
}


function showBackupOptions(player, output, backupName, isPermanent) {

    const BackupPath = path.join(isPermanent ? config.PermanentBackupPath : config.BackupPath, backupName);

    fs.stat(BackupPath, (err, stats) => {
        if (err) {
            sendMessage(player, `无法获取备份属性: ${err}`, 'error');
            return;
        }

        const creationTime = stats.birthtime.toLocaleString();
        const fileSize = formatSize(stats.size);
        const fileName = path.basename(BackupPath);

        const message = `文件名称: ${fileName}\n创建时间: ${creationTime}\n文件大小: ${fileSize}`;
            const fm = mc.newSimpleForm();
		fm.setTitle(`${isPermanent ? '永久备份' : '备份'}: ${backupName}`);
		fm.setContent(`${message}\n请选择一个操作：`);
		fm.addButton("删除备份");
		fm.addButton("回档");
		fm.addButton("重命名备份");
		fm.addButton("上传云端");
		fm.addButton(isPermanent ? "移除永久备份到普通备份" : "添加到永久备份");

    player.sendForm(fm, (player, id) => {
        if (id === null || id === undefined) {
            return;
        }

        switch (id) {
            case 0:
                removeBackup(player, output, backupName, isPermanent);
                break;
            case 1:
                recoverBackup(player, output, backupName, isPermanent);
                break;
            case 2:
                renameBackupGUI(player, output, backupName, isPermanent);
                break;
            case 3:
                uploadBackup(player, output, backupName, isPermanent);
                break;
            case 4:
                confirmTransferBackup(player, output, backupName, isPermanent,isFromGUI=true);
                break;
            default:
                sendMessage(player, "未知的选项", 'error');
                break;
        }
    });
    });

}


function listBackupsGUI(player, output) {
    getAllBackupFilenames().then(backups => {
        if (backups.length === 0) {
            player.sendModalForm("备份列表", "没有找到任何备份文件。", "确定", "取消", (player, result) => {
                if (result) {
                    sendMessage(player, "已确认没有备份文件。", 'info');
                }
            });
            return;
        }

        const fm = mc.newSimpleForm();
        fm.setTitle("备份列表");
        fm.setContent("请选择一个备份文件进行操作：");

        backups.forEach(backup => {
            fm.addButton(backup);
        });

        player.sendForm(fm, (player, id) => {
            if (id === null || id === undefined) {
                return;
            }

            const selectedBackup = backups[id];
            showBackupOptions(player, output, selectedBackup, false); // 标记为非永久备份
        });
    }).catch(error => {
        sendMessage(player, error, 'error');
    });
}

function listPermanentBackupsGUI(player, output) {
        getAllBackupFilenames(true).then(backups => {
        if (backups.length === 0) {
            player.sendModalForm("永久备份列表", "没有找到任何备份文件。", "确定", "取消", (player, result) => {
                if (result) {
                    sendMessage(player, "已确认没有备份文件。", 'info');
                }
            });
            return;
        }

        const fm = mc.newSimpleForm();
        fm.setTitle("永久备份列表");
        fm.setContent("请选择一个备份文件进行操作：");

        backups.forEach(backup => {
            fm.addButton(backup);
        });

        player.sendForm(fm, (player, id) => {
            if (id === null || id === undefined) {
                return;
            }

            const selectedBackup = backups[id];
            showBackupOptions(player, output, selectedBackup, true); // 标记为永久备份
        });
    }).catch(error => {
        sendMessage(player, error, 'error');
    });
}

function cleanupOldBackups(BackupPath, maxAgeDays, callback) {
    const exePath = path.join(config.RecoveryBackupCore, 'Recovery_Backup_Core.exe'); // Rust 程序路径
    const format = config.format;
    // 构建执行命令
    const command = `"${exePath}" cleanup "${BackupPath}" "${maxAgeDays}" "${format}"`;

    // 执行命令
    exec(command, (error, stdout, stderr) => {
        if (error) {
            sendMessage(null, `exec error: ${error.message}`, 'error');
            callback(false);
            return;
        }
        callback(true);
    });
}


function getBackupStats(callback) {
    const exePath = path.join(config.RecoveryBackupCore, 'Recovery_Backup_Core.exe');
    const worldPath = path.resolve(`./worlds/${worldName}`);
    const BackupPath = path.resolve(config.BackupPath);
    const PermanentBackupPath = path.resolve(config.PermanentBackupPath);
    let url = '';
    let auth = '';

    if (config.Serein.enabled) {                     
        url = `${config.Serein.host}/serein/health`;
        auth = config.Serein.auth;
		if (!url || !auth) {
			sendMessage(player, "配置错误：url 或 auth 或 id 参数不能为空！", 'error');
			return;
		}
    }

    const command = `"${exePath}" stats "${worldPath}" "${BackupPath}" "${PermanentBackupPath}"${url ? ` "${url}"` : ''}${auth ? ` "${auth}"` : ''}`;

    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error executing Rust program: ${stderr}`);
            callback(error, null);
            return;
        }

        try {
            //console.log("Command output (stdout):", stdout);
            const stats = JSON.parse(stdout);
            callback(null, stats);
        } catch (parseError) {
            console.error(`Error parsing JSON: ${parseError.message}`);
            callback(parseError, null);
        }
    });
}




function showBackupStats(player, output, isFromGUI = false) {
    getBackupStats((err, stats) => {
        if (err) {
            sendMessage(player, "获取备份信息失败。", 'error');
            return;
        }

        let apiStatus = '';

        if (config.Serein.enabled) {
            apiStatus = stats.api_status;
        }

        // 构建备份信息内容
const backupInfo = `${config.Serein.enabled ? `§eSerein 状态: §a${apiStatus}\n` : ''}
§b当前备份信息：
§6  世界大小: §a${formatSize(stats.directories[0].size)} 
§6  世界文件数量: §a${stats.directories[0].file_count}
§6  备份大小: §a${formatSize(stats.directories[1].size)}
§6  备份文件数量: §a${stats.directories[1].file_count}
§6  永久备份大小: §a${formatSize(stats.directories[2].size)}
§6  永久备份文件数量: §a${stats.directories[2].file_count}`;

        if (isFromGUI) {
            // 如果是从GUI调用，显示图形界面
            const fm = mc.newSimpleForm();
            fm.setTitle("备份信息状态");
            fm.setContent(backupInfo);
            fm.addButton("返回");

            player.sendForm(fm, (player, id) => {
                if (id === null || id === undefined) {
                    return;
                }

                switch (id) {
                    case 0:
                        backupGUI(player, output);
                        break;
                    default:
                        sendMessage(player, "未知的选项", 'error');
                        break;
                }
            });
        } else {
            // 否则，发送文本消息
            sendMessage(player, backupInfo, 'info');
        }
    });
}



function backupGUI(player, output) {
    const fm = mc.newSimpleForm();
    fm.setTitle("备份管理");
    fm.setContent("请选择一个操作：");
    fm.addButton("备份");
    fm.addButton("永久备份");
    fm.addButton("备份列表");
    fm.addButton("永久备份列表");
    fm.addButton("信息状态");

    player.sendForm(fm, (player, id) => {
        if (id === null || id === undefined) {
            return;
        }

        switch (id) {
            case 0:
                backup(player, output,false);
                break;
			case 1:
                backup(player, output,true);
                break;
            case 2:
                listBackupsGUI(player, output);
                break;
            case 3:
                listPermanentBackupsGUI(player, output);
                break;
            case 4:
                showBackupStats(player, output,true);
                break;
            default:
                sendMessage(player, "未知的选项", 'error');
                break;
        }
    });
}

function getAllBackupFilenames(isPermanent = false) {
    const BackupDir = isPermanent ? config.PermanentBackupPath : config.BackupPath;
    const BackupPath = path.resolve(BackupDir); // 转换为绝对路径
    const extension = getExtensionByFormat(config.format);

    // 返回一个 Promise，异步获取所有备份文件名
    return new Promise((resolve, reject) => {
        // 检查备份路径是否存在
        if (!fs.existsSync(BackupPath)) {
            reject(`备份路径不存在: ${BackupPath}`);
            return;
        }

        // 读取备份目录中的文件
        fs.readdir(BackupPath, (err, files) => {
            if (err) {
                reject(`无法读取备份目录: ${err}`);
                return;
            }

            // 过滤备份文件
            const backups = files.filter(file => file.endsWith(extension));
            resolve(backups);
        });
    });
}


function registerCommands() {
    const cmd = mc.newCommand("backup", "Backup management", PermType.Any,0x80);

    let backupFilesEnum = new DynamicEnum(cmd, "BackupFiles");
	let PbackupFilesEnum = new DynamicEnum(cmd, "PBackupFiles");

	getAllBackupFilenames()
		.then(files => {
			backupFilesEnum.addValues(files); // 将文件名添加到 DynamicEnum 实例中
			//console.log("备份文件名已加载:", files);
		})
		.catch(err => {
			console.error(err);
		});
		
	getAllBackupFilenames(true)
		.then(files => {
			PbackupFilesEnum.addValues(files);
			//console.log("备份文件名已加载:", files);
		})
		.catch(err => {
			console.error(err);
		});
	

	cmd.setEnum("GUIAction", ["gui"]);
    cmd.setEnum("ListAction", ["list"]);
    cmd.setEnum("StatsAction", ["stats"]);
    
    cmd.setEnum("RemoveAction", ["remove"]);
    cmd.setEnum("UploadAction", ["upload"]);
    cmd.setEnum("RecoverAction", ["recover"]);
    cmd.setEnum("RenameAction", ["rename"]);
    
    cmd.setEnum("TransferAction", ["transfer"]);
    cmd.setEnum("PTransferAction", ["transfer"]);
    
    cmd.setEnum("PListAction", ["list"]);
    cmd.setEnum("PRemoveAction", ["remove"]);
    cmd.setEnum("PUploadAction", ["upload"]);
    cmd.setEnum("PRecoverAction", ["recover"]);
    cmd.setEnum("PRenameAction", ["rename"]);

    
    cmd.setEnum("PermanentAction", ["permanent"]);

    cmd.setEnum("BackupFiles", []);
    cmd.setEnum("PBackupFiles", []);

    
    cmd.mandatory("action", ParamType.Enum, "GUIAction", 1);
    cmd.mandatory("action", ParamType.Enum, "ListAction", 1);
    cmd.mandatory("action", ParamType.Enum, "StatsAction", 1)
    
    
    cmd.mandatory("action", ParamType.Enum, "RemoveAction", 1);
    cmd.mandatory("action", ParamType.Enum, "UploadAction", 1);
    cmd.mandatory("action", ParamType.Enum, "RecoverAction", 1);
	cmd.mandatory("action", ParamType.Enum, "RenameAction", 1);
	
	cmd.mandatory("action", ParamType.Enum, "TransferAction", 1)
	
	cmd.mandatory("action", ParamType.Enum, "PermanentAction", 1);
	
	cmd.mandatory("PermanentAction", ParamType.Enum, "PListAction",1);
    cmd.mandatory("PermanentAction", ParamType.Enum, "PRecoverAction",1);
    cmd.mandatory("PermanentAction", ParamType.Enum, "PUploadAction",1);
    cmd.mandatory("PermanentAction", ParamType.Enum, "PRemoveAction",1);
    cmd.mandatory("PermanentAction", ParamType.Enum, "PRenameAction",1);
    cmd.mandatory("PermanentAction", ParamType.Enum, "PTransferAction", 1)
    
    cmd.mandatory("filename", ParamType.SoftEnum, "BackupFiles");
    cmd.mandatory("pfilename", ParamType.SoftEnum, "PBackupFiles");
	cmd.mandatory("newname", ParamType.RawText);
	cmd.mandatory("remove", ParamType.Bool);
    
    cmd.overload([]);
    cmd.overload(["GUIAction"]);
    cmd.overload(["ListAction"]);
    cmd.overload(["StatsAction"]);
    
    cmd.overload(["RemoveAction","filename"]);
    cmd.overload(["UploadAction","filename"]);
    cmd.overload(["RecoverAction","filename"]);
    cmd.overload(["RenameAction","filename","newname"]);
    cmd.overload(["TransferAction","filename","remove"]);
    
    cmd.overload(["PermanentAction"]);
    cmd.overload(["PermanentAction","PListAction"]);
    cmd.overload(["PermanentAction","PRemoveAction","pfilename"]);
    cmd.overload(["PermanentAction","PUploadAction","pfilename"]);
    cmd.overload(["PermanentAction","PRecoverAction","pfilename"]);
    cmd.overload(["PermanentAction","PRenameAction","pfilename","newname"]);
    cmd.overload(["PermanentAction","PTransferAction","pfilename","remove"]);

    // 设置命令回调函数
    cmd.setCallback((cmd, origin, output, results) => {
        const player = origin.player;
        const action = results.action;

        const PermanentAction = results.PermanentAction;

		//console.log(`Debug Info: action = ${action}`);

        // 获取权限配置
        const allowlist = config.allowlist;

        // 检查权限：控制台、管理员 (OP)、或在 allowlist 中的玩家
        if (!player || player.isOP() || allowlist.includes(player.xuid)) {
            if (!action) {
                backup(player, output,false);
            } else if (action === "permanent") {
                if (!PermanentAction) {
					backup(player, output,true);
                } else {
                const filename = results.pfilename;
                    switch (PermanentAction) {
                        case "recover":
                                recoverBackup(player, output, filename, true);
                            break;
                        case "list":
                            listBackups(player, output, true);
                            break;
                        case "remove":
                                removeBackup(player, output, filename, true);
                            break;
                        case "rename":
                        const newname = results.newname;
                                renameBackup(player, output, filename, newname, true);
                            break;
                        case "upload":
                                uploadBackup(player, output, filename, true);
                            break;
						case "transfer":
							confirmTransferBackup(player, output, filename, isPermanent = true, isFromGUI = false, remove = results.remove)
                            break;
                        default:
                            sendMessage(player, "未知的永久备份操作。", 'error');
                            break;
                    }
                }
            } else {
            const filename = results.filename;
                // 处理普通备份的操作
                switch (action) {
                    case "recover":
                            recoverBackup(player, output, filename);
                        break;
                    case "list":
                        listBackups(player, output);
                        break;
                    case "remove":
                            removeBackup(player, output, filename);
                        break;
                    case "gui":
                        backupGUI(player, output);
                        break;
                    case "stats":
                        showBackupStats(player, output);
                        break;
                    case "rename":
                    const newname = results.newname;
                            renameBackup(player, output, filename, newname);
                        break;
                    case "upload":
                            uploadBackup(player, output, filename);
                        break;
                    case "transfer":
							confirmTransferBackup(player, output, filename, isPermanent = false, isFromGUI = false, remove = results.remove)
						break;
                    default:
                        sendMessage(player, "未知的备份操作。", 'error');
                        break;
                }
            }
        } else {
            sendMessage(player, "你没有权限执行此命令。", 'error');
        }
    });
    cmd.setup();
}




mc.listen("onServerStarted", function() {
    init();
    registerCommands();
});
