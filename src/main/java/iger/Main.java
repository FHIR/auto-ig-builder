package iger;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.net.MalformedURLException;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.List;
import java.util.stream.Collectors;

import org.eclipse.jgit.api.Git;
import org.eclipse.jgit.api.errors.GitAPIException;
import org.eclipse.jgit.api.errors.InvalidRemoteException;
import org.eclipse.jgit.api.errors.TransportException;

import com.amazonaws.auth.AWSCredentials;
import com.amazonaws.auth.DefaultAWSCredentialsProviderChain;
import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.s3.AmazonS3;
import com.amazonaws.services.s3.AmazonS3Client;
import com.amazonaws.services.s3.model.DeleteObjectsRequest;
import com.amazonaws.services.s3.model.DeleteObjectsRequest.KeyVersion;
import com.amazonaws.services.s3.transfer.MultipleFileUpload;
import com.amazonaws.services.s3.transfer.TransferManager;

public class Main {
	
	private static String FHIR_IG_BUILDER_URL = "http://hl7-fhir.github.io/org.hl7.fhir.igpublisher.jar";

	public static String build(Req req, Context context) throws Exception {
		
		if (!req.getService().equals("github.com")){
			throw new Exception(String.format("Please use a 'github.com' repo, not '%1$s'", req.getService()));
		}
		
		String cloneDir = tempDir();
		String igPath = String.format("%1$s/%2$s", req.getOrg(), req.getRepo());
		String gitRepoUrl = String.format("https://%1$s/%2$s", req.getService(), igPath);
		File publisherJar = File.createTempFile("builder", "jar");

		AWSCredentials creds = new DefaultAWSCredentialsProviderChain().getCredentials();
		AmazonS3 s3 = new AmazonS3Client(creds);
		TransferManager tx = new TransferManager(creds);
		
		System.out.println("Downloading publisher");
		downloadPublisher(publisherJar);

		System.out.println("Cloning repo " + gitRepoUrl);
		cloneRepo(cloneDir, gitRepoUrl);
		
		System.out.println("Building docs");
		buildDocs(publisherJar, cloneDir);
		
		System.out.println("Deleting existing objects");
		clearBucket(req.getTarget(), igPath, s3);
		
		System.out.println("Uploading");
		uploadToBucket(igPath, req.getTarget(), cloneDir, tx);

		return "Published to: " + "https://"+req.getTarget()+".s3-website-us-east-1.amazonaws.com/" +igPath;
	}
	
	public static void run(File fromDir, String... args) throws Exception {
		ProcessBuilder p = (new ProcessBuilder()).directory(fromDir).command(args).inheritIO();
		p.environment().put("PATH", p.environment().get("PATH").concat(":/var/task/bin:/var/task/ruby/bin"));
		p.start().waitFor();
	}

	public static String tempDir() throws IOException {
		return Files.createTempDirectory("tempfiles").toAbsolutePath().toString();
	}

	private static void downloadPublisher(File jarFile) throws MalformedURLException, IOException {
		URL website = new URL(FHIR_IG_BUILDER_URL);
		try (InputStream in = website.openStream()) {
		    Files.copy(in, jarFile.toPath(), StandardCopyOption.REPLACE_EXISTING);
		}
	}

	private static void clearBucket(String bucket, String path, AmazonS3 s3) {
		List<KeyVersion> keys = s3.listObjects(bucket, path)
				.getObjectSummaries()
				.stream()
				.map(i -> new KeyVersion(i.getKey()))
				.collect(Collectors.toList());
		
		if (keys.size() > 0) {
			s3.deleteObjects(
					new DeleteObjectsRequest(bucket)
					.withKeys(keys));
		}
	}

	private static void buildDocs(File jarFile, String igClone) throws Exception {
		String igJson = new File(igClone, "ig.json").toPath().toAbsolutePath().toString();
		File logFile = new File(new File(System.getProperty("java.io.tmpdir")), "fhir-ig-publisher.log");

		run(new File(igClone), "java", "-jar", jarFile.getAbsolutePath().toString(), "-ig", igJson, "-out", igClone);
		run(new File(igClone), "mv", logFile.getAbsolutePath().toString(), ".");
		run(new File(igClone), "/var/task/bin/build-index.sh");
		
	}

	private static void cloneRepo(String igClone, String source)
			throws GitAPIException, InvalidRemoteException, TransportException {
		   Git.cloneRepository()
		  .setURI(source)
		  .setDirectory(new File(igClone))
		  .call();
	}

	private static void uploadToBucket(String path, String bucket, String buildDir, TransferManager tx) throws InterruptedException {
		MultipleFileUpload myUpload = tx.uploadDirectory(bucket, path, new File(buildDir), true);
		myUpload.waitForCompletion();
		tx.shutdownNow();
	}

	public static void main(String[] args) throws Exception {
		System.out.println("Starting main");
		Req req = new Req();
		req.setService("github.com");
		req.setOrg("test-igs");
		req.setRepo("simple");
		req.setTarget("ig.fhir.org");
		build(req, null);
		System.out.println("Finishing main");
	}

}