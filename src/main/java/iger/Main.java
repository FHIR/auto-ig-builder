package iger;

import java.io.File;
import java.nio.file.Paths;
import com.amazonaws.services.lambda.runtime.Context;

public class Main {

	public String build(String ig, Context context) throws Exception{

		System.out.println("Bashing!");
		new ProcessBuilder().command("bash", "prepare.sh")
		    .directory(new File("/var/task"))
		    .inheritIO().start().waitFor();

		String pwd = Paths.get(".").toAbsolutePath().normalize().toString();
		System.out.println("PWD: " + pwd);

		String dir = "/var/task";

		File directory = new File(dir);
		// get all the files from a directory
		File[] fList = directory.listFiles();
		if (fList == null) {
			System.out.println("no such dir as " + dir);
		} else {
			for (File file : fList) {
				System.out.println(file.getName());
			}

		}
		return dir;
	}

	public static void main(String[] args) throws Exception {
	}

}
