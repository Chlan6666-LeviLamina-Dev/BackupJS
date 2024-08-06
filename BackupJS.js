const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

ll.registerPlugin(
    "BackupJS",
    "A plugin to manage backups",
    [0, 0, 1],
    {}
);

const pluginName = "BackupJS";
const backup_tmp = "./backup_tmp";
const worldName = /level-name=(.*)/.exec(File.readFrom('./server.properties'))[1];
const configPath = "plugins/BackupJS/config.json";

var defaultConfig = {
    Language: "zh_CN",
    MaxStorageTime: 7,
    BackupPath: "./backup",
    Compress: 0,
    MaxWaitForZip: 1800,
    "7za": "./plugins/BackupJS",
    RecoveryBackupCore: "./plugins/BackupJS",
    serverExe:"bedrock_server_mod.exe",
    upload: {
        remotePath: '/backup',
        webdavUrl: 'https://xxx.com/webdav',
        username: '123',
        password: '114514'
    },
    allowlist: ["114514"]
};


function readConfig() {
    // 检查配置文件是否存在
    if (!fs.existsSync(configPath)) {
        // 如果配置文件不存在，生成默认配置文件
        try {
            fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 4), 'utf8');
            sendMessage(null, `Default config file created at ${configPath}`, 'info');
        } catch (error) {
            sendMessage(null, `Failed to create default config file: ${error}`, 'error');
            return defaultConfig;
        }
    }

    // 读取配置文件
    try {
        const data = fs.readFileSync(configPath, 'utf8');
        return { ...defaultConfig, ...JSON.parse(data) };
    } catch (error) {
        sendMessage(null, `Failed to read or parse config: ${error}`, 'error');
        return defaultConfig;
    }
}

const config = readConfig();
 
function clearBackupTmpPath() {
    if (File.exists(backup_tmp)) {
        File.delete(backup_tmp);
    }
    File.mkdir(backup_tmp);
}

// 初始化
function init() {
    clearBackupTmpPath();
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

function copyFolder(source, target, callback) {
    const exePath = path.join(config.RecoveryBackupCore, 'Recovery_Backup_Core.exe'); // Rust 程序路径
    const command = `"${exePath}" copy "${source}" "${target}"`; // 传递操作和路径作为参数

    exec(command, (error, stdout, stderr) => {
        if (error) {
            sendMessage(null, `exec error: ${error}`, 'error');
            callback(false);
            return;
        }
        callback(true);
    });
}

function cleanupOldBackups(backupPath, maxAgeDays, callback) {
    const exePath = path.join(config.RecoveryBackupCore, 'Recovery_Backup_Core.exe'); // Rust 程序路径
    const command = `"${exePath}" cleanup "${backupPath}" "${maxAgeDays}"`; // 传递操作和路径作为参数

    exec(command, (error, stdout, stderr) => {
        if (error) {
            sendMessage(null, `exec error: ${error}`, 'error');
            callback(false);
            return;
        }
        callback(true);
    });
}

function compressFolder(source, target, callback) {
    const exePath = path.join(config["7za"], '7za.exe');
    const compressLevel = config.Compress;
    const maxWaitForZip = config.MaxWaitForZip;

    // 确保只压缩 source 目录中的内容，而不是整个目录本身
    const command = `"${exePath}" a -mx=${compressLevel} "${target}" "${source}\\*"`; // 使用通配符

    const compressProcess = exec(command, (error, stdout, stderr) => {
        clearTimeout(timeout);
        if (error) {
            sendMessage(player, `exec error: ${error}`, 'error');
            callback(false);
            return;
        }
        callback(true);
    });

    const timeout = setTimeout(() => {
        compressProcess.kill();
        sendMessage(player, `压缩超时 (${maxWaitForZip} s)`, 'error');
        callback(false);
    }, maxWaitForZip * 1000);
}


function backup(player, output) {
    const startTime = new Date();
	const timestamp = system.getTimeStr().replace(/ /, '_').replace(/:/g, '-');
    const worldPath = `./worlds/${worldName}`;
    const zipFileName = path.join(config.BackupPath, `${worldName}_${timestamp}.zip`);
    const maxAgeDays = config.MaxStorageTime;

    if (!File.exists(config.BackupPath)) {
        File.mkdir(config.BackupPath);
    }
    sendMessage(player, "开始执行备份...", 'info');
    clearBackupTmpPath();
     // 检查 maxAgeDays 是否为 -1，如果不是，则执行清理旧备份操作
     if (maxAgeDays !== -1) {
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
    mc.runcmdEx("save hold");
    copyFolder(worldPath, backup_tmp, (result) => {
        mc.runcmdEx("save resume");
        
        if (result) {
            sendMessage(player, "复制完成", 'info');
            
            compressFolder(backup_tmp, zipFileName, (compressResult) => {
                const endTime = new Date();
                const duration = endTime - startTime; // 计算总耗时
                
                if (compressResult) {
                    sendMessage(player, `备份完成，总耗时 ${duration} ms`, 'info');
                } else {
                    sendMessage(player, "压缩失败", 'error');
                }
            });
        } else {
            sendMessage(player, "复制失败", 'error');
        }
    });
}


function recoverBackup(player, output, backupFilename) {
    const backupPath = path.resolve(config.BackupPath); // 转换为绝对路径
    const backupFilePath = path.resolve(backupPath, backupFilename); // 转换为绝对路径
    const serverExe = config.serverExe;
    const serverDir = path.resolve("."); // 服务器目录路径

    const exePath = path.join(config.RecoveryBackupCore, 'Recovery_Backup_Core.exe'); // Rust 程序路径

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

    // 创建批处理文件内容
    const batchContent = `
@echo off
"${exePath}" recover "${backupFilePath}" "${serverDir}" "${worldName}" "${serverExe}"
`;

    const batchFilePath = path.resolve(__dirname, 'startup_script.bat');
    fs.writeFileSync(batchFilePath, batchContent);

    // 使用 PowerShell 启动批处理文件
    const command = `powershell -NoProfile -Command "Start-Process cmd -ArgumentList '/c \"${batchFilePath}\"' "`;
    console.log(`启动恢复程序: ${command}`); // 输出命令以供调试

    exec(command, (error, stdout, stderr) => {
    });

    mc.runcmdEx("stop"); // 立即关闭服务器
}

// 列出备份文件功能
function listBackups(player, output) {
    const backupPath = path.join(config.BackupPath);

    if (!File.exists(backupPath)) {
        sendMessage(player, `备份路径不存在: ${backupPath}`, 'error');
        return;
    }

    fs.readdir(backupPath, (err, files) => {
        if (err) {
            sendMessage(player, `读取备份目录失败: ${err}`, 'error');
            return;
        }
        const backupFiles = files.filter(file => path.extname(file).toLowerCase() === '.zip');

        if (backupFiles.length === 0) {
            sendMessage(player, '没有找到任何备份文件。', 'info');
        } else {
            sendMessage(player, '找到以下备份文件:', 'info');
            backupFiles.forEach(file => sendMessage(player, file, 'info'));
        }
    });
}
function uploadBackup(player, output, backupName) {
    const exePath = path.join(config.RecoveryBackupCore, 'Recovery_Backup_Core.exe');
    const backupPath = path.resolve(config.BackupPath); // 转换为绝对路径
    const sanitizedBackupName = backupName.replace(/['"]/g, ''); // 移除不必要的引号
    const backupFilePath = path.resolve(backupPath, sanitizedBackupName); // 转换为绝对路径
    const remotePath = config.upload.remotePath;
    const webdavUrl = config.upload.webdavUrl;
	const username = config.upload.username;
	const password = config.upload.password;

    if (!fs.existsSync(backupFilePath)) {
    sendMessage(player, `Backup file not found: ${backupFilePath}`, 'error');
    return;
	}

    const command = `"${exePath}" upload "${backupFilePath}" "${remotePath}" "${webdavUrl}" "${username}" "${password}"`;

    exec(command, (error, stdout, stderr) => {
        if (error) {
            sendMessage(player, `Error executing upload: ${error.message}`, 'error');
            return;
        }

        if (stderr) {
            sendMessage(player, `Upload stderr: ${stderr}`, 'info');
            return;
        }
        sendMessage(player, `Upload stdout: ${stdout}`, 'info');
    });
}

// 删除备份文件功能
function removeBackup(player, output, filename, isFromGUI = false) {
    const backupPath = path.join(config.BackupPath, filename);

    fs.unlink(backupPath, (err) => {
        if (err) {
            sendMessage(player, `删除备份失败: ${err}`, 'error');
            return;
        }

        sendMessage(player, `备份 ${filename} 已成功删除`, 'info');

        if (isFromGUI) {
            listBackupsGUI(player, output); // 重新显示备份列表
        }
    });
}


function showBackupOptions(player, output, backupName) {
    const fm = mc.newSimpleForm();
    fm.setTitle(`备份: ${backupName}`);
    fm.setContent("请选择一个操作：");
    fm.addButton("删除备份");
    fm.addButton("回档");
    fm.addButton("重命名备份");
    fm.addButton("上传云端");

    player.sendForm(fm, (player, id) => {
        if (id === null || id === undefined) {
            return;
        }

        switch (id) {
            case 0:
                removeBackup(player, output, backupName);
                break;
            case 1:
                recoverBackup(player, output, backupName);
                break;
            case 2:
                renameBackupGUI(player, output, backupName);
                break;
            case 3:
                uploadBackup(player, output, backupName);
                break;
            default:
                sendMessage(player, "未知的选项", 'error');
                break;
        }
    });
}

function renameBackup(player, output, filename, newname, isGUI = false) {
    // 移除可能的引号
    let sanitizedFilename = filename.replace(/"/g, '');
    let sanitizedNewname = newname.replace(/"/g, '');

    // 如果文件名不以 .zip 结尾，则添加 .zip
    if (!sanitizedFilename.endsWith('.zip')) {
        sanitizedFilename += '.zip';
    }
    if (!sanitizedNewname.endsWith('.zip')) {
        sanitizedNewname += '.zip';
    }

    const backupPath = path.join(config.BackupPath, sanitizedFilename);
    const newBackupPath = path.join(config.BackupPath, sanitizedNewname);

    if (fs.existsSync(newBackupPath)) {
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

    fs.rename(backupPath, newBackupPath, (err) => {
        if (err) {
            sendMessage(player, `重命名失败: ${err}`, 'error');
            return;
        }
        sendMessage(player, `备份 ${sanitizedFilename} 已重命名为 ${sanitizedNewname}`, 'info');

        if (isGUI) {
            listBackupsGUI(player, output); 
        } else {
            listBackups(player, output); 
        }
    });
}


function renameBackupGUI(player, output, backupName) {
    const fm = mc.newCustomForm();
    fm.setTitle("重命名备份");
    fm.addInput("新备份名称", "请输入新的备份名称", backupName.replace('.zip', ''));

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
                        renameBackupGUI(player, output, backupName); // 重新显示表单
                    } 
                }
            );
            return;
        }

        renameBackup(player, output, backupName, `${newName}.zip`, true);
    });
}






function listBackupsGUI(player, output) {
    const backupPath = path.join(config.BackupPath);

    fs.readdir(backupPath, (err, files) => {
        if (err) {
            sendMessage(player, `无法读取备份目录: ${err}`, 'error');
            return;
        }

        const backups = files.filter(file => file.endsWith('.zip'));

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
            showBackupOptions(player, output, selectedBackup);
        });
    });
}




// GUI 操作面板功能
function backupGUI(player, output) {
    const fm = mc.newSimpleForm();
    fm.setTitle("备份管理");
    fm.setContent("请选择一个操作：");
    fm.addButton("备份");
    fm.addButton("备份列表");

    player.sendForm(fm, (player, id) => {
            if (id === null || id === undefined) {
                return;
            }

        switch (id) {
            case 0:
                backup(player, output);
                break;
            case 1:
                listBackupsGUI(player, output);
                break;
            default:
                sendMessage(player, "未知的选项", 'error');
                break;
        }
    });
}
function registerCommands() {
    const cmd = mc.newCommand("backup", "Backup management", PermType.Any);

    // 设置命令的枚举
    cmd.setEnum("BackupAction", ["recover", "list", "remove", "gui", "rename", "upload"]);

    // 添加命令参数
    cmd.optional("action", ParamType.Enum, "BackupAction");
    cmd.optional("filename", ParamType.RawText);
    cmd.optional("newname", ParamType.RawText);

    // 添加命令重载
    cmd.overload([]);
    cmd.overload(["action"]);
    cmd.overload(["action", "filename"]);
    cmd.overload(["action", "filename", "newname"]);

    // 设置命令回调
    cmd.setCallback((cmd, origin, output, results) => {
        const player = origin.player;
        const action = results.action;
        const filename = results.filename;
        const newname = results.newname;

        // 获取 allowlist 配置
        const allowlist = config.allowlist;

        // 检查权限：控制台、管理员 (OP)、或在 allowlist 中的玩家
        if (!player||player.isOP()||allowlist.includes(player.xuid)) {

        if (!action) {
            backup(player, output);
        } else {
            switch (action) {
                case "recover":
                    if (filename) {
                        recoverBackup(player, output, filename);
                    } else {
                        sendMessage(player, "必须提供要恢复的备份文件名。", 'error');
                    }
                    break;
                case "list":
                    listBackups(player, output);
                    break;
                case "remove":
                    if (filename) {
                        removeBackup(player, output, filename);
                    } else {
                        sendMessage(player, "必须提供要删除的备份文件名。", 'error');
                    }
                    break;
                case "gui":
                    backupGUI(player, output);
                    break;
                case "rename":
                    if (filename && newname) {
                        renameBackup(player, output, filename, newname);
                    } else {
                        sendMessage(player, "必须提供要重命名的备份文件名和新名称。", 'error');
                    }
                    break;
                case "upload":
                    if (filename) {
                        uploadBackup(player, output, filename);
                    } else {
                        sendMessage(player, "必须提供要上传的备份文件名。", 'error');
                    }
                    break;
                default:
                    output.error("未知的备份操作。");
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
